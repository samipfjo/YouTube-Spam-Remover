"use strict";

/**
 * YouTube Spam Remover
 * 
 * Project homepage: https://github.com/luketimothyjones/youtube-spam-remover/
 *
 * Copyright 2022, Luke Pflibsen-Jones (https://github.com/luketimothyjones)
 * Licensed under GPLv3
 *
 * This program is free software: you can redistribute it and/or modify it under the terms
 * of the GNU General Public License as published by the Free Software Foundation, either
 * version 3 of the License, or (at your option) any later version. This program is distributed
 * in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 *
**/

declare var browser: any;
declare var chrome: any;
declare var pako: any;

{
	const LogLevel = {
		Off: 0,
		Basic: 1,
		Verbose: 2
	};

	const SpamType = {
		None: 'not spam',
		URL: 'unapproved URL',
		Text: 'forbidden text',
		Imposter: 'copycat avatar',
		OpenNSFW: 'potentially NSFW avatar',
		AlreadySeen: 'previously marked as spam'
	};

	// Defaults
	var YTSRConfig = {
		log_level: LogLevel.Off,
		pixel_match_threshold: 100,
		opennsfw_threshold: .21,

		// These three can be modified in the extension's config area
		explain_spam: true,
		do_nsfw_checking: true,
		do_priming: true
	};

	// ========
    const get_ext_url = (typeof chrome === 'undefined' ? browser : chrome).runtime.getURL; /* eslint-disable-line */
	const scripts = [get_ext_url('pixelmatch.min.js'), get_ext_url('opennsfw.min.js')];

	// ========
	var ytsr_instance: any = null;
	var logger: any;

	// ========
	class YoutubeSpamRemover {
		private _worker: Worker;
		private _pinned_comment: HTMLElement | null | false;
		private _channel_handle: string | null;
		private _video_owner_avatar_load_promise: Promise<string> | null;
		private _cur_elem_id: number;
		private _checked_ids: Set<string>;
		private _observer: MutationObserver;

		// ----
		constructor() {
			logger.basic('Initializer called');

			this._pinned_comment = null;
			this._channel_handle = null;
			this._video_owner_avatar_load_promise = null;

			this._cur_elem_id = 0;
			this._checked_ids = new Set([]);

			this._initializeObserver 	   = this._initializeObserver.bind(this);
			this._attachVideoEventListener = this._attachVideoEventListener.bind(this);
			this._videoDataInit = this._videoDataInit.bind(this);
			this.scanComments   = this.scanComments.bind(this);

			(async () => {
				this._worker = await WorkerManager.loadWorker();
				await Utils.loadSettings();
				await WorkerManager.initializeWorker(this._worker);

				this._video_owner_avatar_load_promise = Utils.getOwnerAvtar();
				this._video_owner_avatar_load_promise.then((avatar_src) => {
					this._worker.postMessage(['video_owner_avatar', avatar_src]);
					logger.verbose('Sent video owner avatar to worker');
				});

				this._observer = new MutationObserver(this.scanComments);
				this._initializeObserver();
			})();
		}

		// ----
		private _initializeObserver() {
			const create_observer_handler = async () => {
				this._observer.observe(document.querySelector('ytd-comments') as HTMLElement,
									   {attributeFilter: ["src"], subtree: true});
				logger.verbose('Initializer complete');
			}

			// Wait for the comments element to exist, then hook
			if (document.querySelector('ytd-comments') === null) {
				let comments_loaded = false;
				let video_loaded = false;

				(new MutationObserver(async (_, obs) => {
					if (!video_loaded && document.querySelector('ytd-player video') !== null) {
						this._attachVideoEventListener();
						video_loaded = true;
					}

					if (!comments_loaded && document.querySelector('ytd-comments') !== null) {
						create_observer_handler();
						comments_loaded = true;
					}

					if (document.querySelector('ytd-player video') !== null &&
						document.querySelector('ytd-comments') !== null)
						{
						obs.disconnect();
					}
				})).observe(document.querySelector('body') as HTMLElement, {childList: true, subtree: true});

			// The comments element already exists; hook immediately
			} else {
				this._attachVideoEventListener();
				create_observer_handler();
			}
		}

		// ----
		private _attachVideoEventListener() {
			const video: HTMLVideoElement | null = document.querySelector('ytd-player video');

			if (YTSRConfig.do_priming && video !== null) {
				// Tell worker the video has loaded and priming can begin
				const handler = () => {
					if (video.played.length >= 1) {
						logger.verbose('Video playing signal sent');

						this._worker.postMessage(['video_playing']);
						video.removeEventListener('progress', handler);
					}
				};
				video.addEventListener('progress', handler);
			}
		}

		// ----
		private _videoDataInit() {
			if (this._channel_handle === null) {
				const channel_handle_elem = document.querySelector('#channel-name #text.ytd-channel-name a') as HTMLElement;
				this._channel_handle = channel_handle_elem?.innerText.replace('@', '').trim();
				logger.verbose(`Channel handle is "${this._channel_handle}"`);
			}

			// Initialize filters for pinned comments and video owner comments
			if (this._pinned_comment === null) {
				const top_comment: HTMLElement | null = document.querySelector('#comments #contents ytd-comment-thread-renderer:first-of-type > ytd-comment-renderer:first-of-type');

				this._pinned_comment = (top_comment?.querySelector('#pinned-comment-badge') as HTMLElement) ? top_comment : false;

				if (this._pinned_comment !== null && this._pinned_comment !== false) {
					this._pinned_comment.dataset.ytsrSpam = '0';
				}
			}
		}

		// ----
		public async scanComments(mutation_records: MutationRecord[]) {
			await this._video_owner_avatar_load_promise;
			
			this._videoDataInit();

			// Loop through the recieved change events, which are the 'src' tag getting changes on the avatar
			for (const record of mutation_records) {
				// Get the comment element that is the parent of the avatar
				const comment = (record.target as HTMLImageElement).closest('ytd-comment-renderer');

				if (comment === null) { continue; }

				// Assign the comment element a unique ID
				let cur_elem_id: string;

				if (typeof (comment as HTMLElement).dataset.ytsrId === 'undefined') {
					cur_elem_id = this._cur_elem_id.toString();
					(comment as HTMLElement).dataset.ytsrId = cur_elem_id;
					this._cur_elem_id++;

				} else {
					cur_elem_id = (comment as HTMLElement).dataset.ytsrId as string;
				}

				if (this._checked_ids.has(cur_elem_id)) { continue; }

				let user_handle = (comment.querySelector('#channel-name #text') as HTMLElement)?.innerText;
				user_handle = user_handle ? user_handle : (comment.querySelector('#header-author #author-text span') as HTMLElement)?.innerText;
				user_handle = user_handle?.replace('@', '').trim();

				// Certain comments can be defacto trusted
				if (comment === this._pinned_comment ||									// Pinned comment
					comment.querySelector('#creator-heart-button') !== null ||			// Image hearted by video author
					comment.querySelector('.badge-style-type-verified') !== null ||		// Verified YouTube users
					user_handle === this._channel_handle)								// Video author
					{
						logger.basic(`Skipping comment by "${user_handle}" due to defacto trust`);
						(comment as HTMLElement).dataset.ytsrSpam = '0';

						continue;
				}

				const author_name: HTMLElement = comment.querySelector('#author-text') as HTMLElement;
				const author_image: HTMLImageElement = comment.querySelector('#img') as HTMLImageElement;
				const comment_content: HTMLElement | null = comment.querySelector('#content-text');

				if (author_name !== null && comment_content !== null) {
					this._checked_ids.add(cur_elem_id);

					if (author_image === null || !author_image.complete || author_image.src === '') {
						logger.verbose(`Adding event listener to comment #${cur_elem_id} by ${user_handle}`);

						Utils.createImageEventListener(comment as HTMLElement, () => {
							const user_handle = ((comment.querySelector('#header-author #author-text span') as HTMLElement)?.innerText).trim();
							const content = (comment.querySelector('#content-text') as HTMLElement).innerText;
			
							const fresh_author_image = comment.querySelector('img') as HTMLImageElement;
							logger.verbose(`Sending avatar from comment #${cur_elem_id} by "${user_handle}" to worker`);
							this._worker.postMessage([cur_elem_id, user_handle, content, fresh_author_image.src]);
						});

					} else {
						const author_image_url = author_image.src;
						logger.verbose(`Sending avatar from comment #${cur_elem_id} by "${user_handle}" to worker`);
						this._worker.postMessage([cur_elem_id, user_handle, comment_content.innerText, author_image_url]);
					}
				}
			}
		}
	}

	// =================
	class WorkerManager {
		public static async loadWorker(): Promise<Worker> {
			return new Promise(resolve => {
				if (typeof chrome !== 'undefined') {  /* eslint-disable-line */
					// Chrome workaround
					let xhr = new XMLHttpRequest();
					xhr.responseType = 'blob';
	
					xhr.onload = async () => {
						const ytsr_worker = new Worker(URL.createObjectURL(xhr.response));
						ytsr_worker.onmessage = WorkerManager.handleWorkerMessage;
						ytsr_worker.postMessage(['config', YTSRConfig]);
						ytsr_worker.postMessage(['script_urls', scripts]);
	
						resolve(ytsr_worker);
					};
	
					xhr.open("GET", get_ext_url('yt-spam-remover-worker.js'), true);
					xhr.send();
	
				} else {
					const ytsr_worker = new Worker(get_ext_url('yt-spam-remover-worker.js'));
					ytsr_worker.onmessage = WorkerManager.handleWorkerMessage;
					ytsr_worker.postMessage(['config', YTSRConfig]);
					ytsr_worker.postMessage(['script_urls', scripts]);
	
					resolve(ytsr_worker);
				}
			});
		}

		// ----
		static async initializeWorker(worker: Worker): Promise<void> {
            // Get allowed-sites.json and pass it to the worker
            const is_firefox = typeof browser !== 'undefined';

            const allowed_sites_url = get_ext_url(is_firefox ? 'allowed-sites.json' : 'allowed-sites.json.gz');
            try {
                var response = await fetch(allowed_sites_url);

            } catch (error) {
                logger.basic('Error while getting allowed sites list');
				console.debug(error);
				return;
            }

            if (is_firefox) {
                worker.postMessage(['allowed_sites', await response.json()]);
            } else {
                worker.postMessage(['allowed_sites', await response.blob()]);
            }
        }

		// ----
		public static handleWorkerMessage(event: {'data': [string, string]}): void {
			if (event.data[0] === 'opennsfw_loaded') { return; }

			if (event.data[0] === 'content_ok') {
				const comment_elem = document.querySelector('ytd-comment-renderer[data-ytsr-id="' + event.data[1] + '"]') as (HTMLElement | null);
				if (comment_elem !== null) { comment_elem.dataset.ytsrContentOk = '1'; }
				else { logger.verbose(`Couldn't assign content-ok to comment #${event.data[1]} as it was null`); }
				return;
			}

			const [msg_id, spam_type] = event.data;

			const comment_elem = document.querySelector('ytd-comment-renderer[data-ytsr-id="' + msg_id + '"]') as (HTMLElement | null);

			if (comment_elem === null) { 
				logger.verbose(`Couldn't process worker message regarding comment #${msg_id} as it was null`);
				return;
			}

			if (spam_type === SpamType.None) {
				comment_elem.dataset.ytsrSpam = '0';

			} else if (typeof comment_elem.dataset.ytsrSpam === 'undefined') {
				comment_elem.dataset.ytsrSpam = '1';

				const spam_toggle_node = document.createElement('span');
				spam_toggle_node.dataset.ytsrReason = YTSRConfig.explain_spam ? `  [${spam_type}]` : '';

				spam_toggle_node.classList.add('ytsr-spam-toggler');
				(comment_elem as any).parentElement.insertBefore(spam_toggle_node, comment_elem);

				spam_toggle_node.addEventListener('click', () => {
					comment_elem.classList.toggle('ytsr-display-override');
					spam_toggle_node.classList.toggle('ytsr-display-override');
				});
			}
		}
	}

	// ========
	class Utils {

		public static makeLogger(this: void, log_level: number, prefix: string): {'basic': Function, 'verbose': Function} {
			return {
				basic:   log_level >= 1 ? globalThis.console.debug.bind(this, prefix) : () => {},
				verbose: log_level >= 2 ? globalThis.console.debug.bind(this, prefix) : () => {}
			}
		}
	
		// ----
		public static async loadSettings(): Promise<void> {
			return new Promise((resolve) => {
				// Disable OpenNSFW priming by default if the machine is a potato to improve video playback experience
				const machine_not_potato = navigator.hardwareConcurrency >= 4;

				const is_chrome = typeof browser === 'undefined';
				const storage = is_chrome ? chrome.storage.sync : browser?.storage.local;

				const handler = (res: any) => {
					YTSRConfig.do_nsfw_checking = res.opennsfw_enabled 			?? machine_not_potato;
					YTSRConfig.do_priming 		= res.opennsfw_priming_enabled 	?? machine_not_potato;
					YTSRConfig.explain_spam 	= res.explain_enabled 			?? YTSRConfig.explain_spam;

					resolve();
				};

				if (is_chrome) {
					storage.get(['opennsfw_enabled', 'opennsfw_priming_enabled', 'explain_enabled'], handler);
				} else {
					storage.get(['opennsfw_enabled', 'opennsfw_priming_enabled', 'explain_enabled']).then(handler);
				}
			});
		}

		// ----
		public static createImageEventListener(comment_elem: HTMLElement, callback: any) {
			const cur_elem_id: string = comment_elem.dataset.ytsrId as string;
			let image = comment_elem.querySelector('#img'); 

			// Allow a maximum of 5s to wait for image to load before trying again
			const abort_controller = new AbortController();

			const abort_timeout = setTimeout(() => {
				abort_controller.abort();
				Utils.createImageEventListener(comment_elem, callback);
			}, 5_000);

			let handler = () => {
				clearTimeout(abort_timeout);

				const user_handle = ((comment_elem.querySelector('#header-author #author-text span') as HTMLElement)?.innerText).trim();
				logger.verbose(`Load event fired for comment #${cur_elem_id} by ${user_handle}`);

				const fresh_author_image = comment_elem.querySelector('img') as HTMLImageElement;

				if (fresh_author_image.complete && fresh_author_image.src !== '') {
					logger.verbose(`Avatar for comment #${cur_elem_id} at ${fresh_author_image.src} loaded`);
					callback();
				} else {
					Utils._waitForImageLoad(`ytd-comment-renderer[data-ytsr-id="${cur_elem_id} #img"]`).then(callback);
				}
			};

			image?.addEventListener('load', handler, { signal: abort_controller.signal });
		}

		// ----
		public static async getOwnerAvtar(): Promise<string> {
			return new Promise(async (resolve) => {
				const selector = 'ytd-video-owner-renderer img';

				// Send the video owner's avatar imagedata to the worker
				let video_owner_avatar: HTMLImageElement | null = null;
				while (video_owner_avatar === null) {
					video_owner_avatar = document.querySelector(selector);

					if (video_owner_avatar !== null) {
						Utils._waitForImageLoad(selector).then(() => {
							resolve((video_owner_avatar as HTMLImageElement).src);
							return;
						});
					}

					await new Promise(r => setTimeout(r, 50));
				}
			});
		}
	
		// ----
		private static async _waitForImageLoad(selector: string): Promise<boolean> {
			let image: HTMLImageElement | null;

			const scan_image_elem = async (resolve: Function) => {
				for (let attempts = 1; attempts <= 200; attempts++) {
					image = document.querySelector(selector);

					if (image?.complete && image?.src !== '') {
						logger.verbose(`Author avatar at ${image.src} loaded`);

						resolve(true);
						return true;
					}
	
					await new Promise(r => setTimeout(r, 50));
				}

				resolve(false);
				return false;
			}

			return new Promise(async (resolve) => {
				const success = await scan_image_elem(resolve);

				if (!success) {
					logger.verbose(`Adding event listener for: ${image?.src}`);
					image?.addEventListener('load', () => scan_image_elem(resolve));
				} else {
					resolve(true);
				}
			});
		}
	}

	// ================

	logger = Utils.makeLogger(YTSRConfig.log_level, 'YOUTUBE_SPAM_REMOVER ::');

	// Run the extension
	ytsr_instance = new YoutubeSpamRemover();
}
