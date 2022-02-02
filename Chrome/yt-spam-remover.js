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

{
	let get_ext_url = (chrome !== 'undefined' ? chrome : browser).runtime.getURL;  /* eslint-disable-line */

	let spam_worker = null;
	if (chrome !== 'undefined') {  /* eslint-disable-line */
		// Chrome workaround

		var xhr = new XMLHttpRequest();
		xhr.responseType = 'blob';

		xhr.onload = () => {
			spam_worker = new Worker(URL.createObjectURL(xhr.response));
			spam_worker.onmessage = YoutubeSpamRemover._handle_worker_message;
		}

		xhr.open("GET", get_ext_url('yt-spam-remover-worker.js'), true);
		xhr.send();

	} else {
		spam_worker = new Worker(get_ext_url('yt-spam-remover-worker.js'));  /* eslint-disable-line */
		spam_worker.onmessage = YoutubeSpamRemover._handle_worker_message;
	}
	
	let cur_elem_id = 0;

	class YoutubeSpamRemover {

		// ================
		// Development settings

		static _do_debug_logging = false;

		// ================
		// Public methods

		constructor() {
			YoutubeSpamRemover._log('init');

			YoutubeSpamRemover._worker_init();

			// Wait for the comments element to exist, then hook
			if (document.querySelector('ytd-comments') === null) {
				(new MutationObserver((_, obs) => {
					if (document.querySelector('ytd-comments') !== null) {
						obs.disconnect();
						window.YT_SPAM_RM_OBSERVER = (new MutationObserver(this.scan_comments))
														.observe(document.querySelector('ytd-comments'),
																{childList: true, subtree: true});
					}
				})).observe(document.querySelector('body'), {childList: true, subtree: true});

			// The comments element already exists; hook immediately
			} else {
				window.YT_SPAM_RM_OBSERVER = (new MutationObserver(this.scan_comments))
												.observe(document.querySelector('ytd-comments'),
														{childList: true, subtree: true});
			}
		}

		scan_comments() {
			// This could be done more efficiently by parsing the mutations themselves, but
			// this is sufficiently fast and is not tightly coupled to YouTube's MutationRecords

			// TODO :: Ignore hovering over "like" and "dislike"

			for (let comment of document.querySelectorAll('ytd-comment-renderer:not([data-ytsr-id])')) {
				// Mark for retrieval / flag the comment as tested (will be skipped on following scans)
				comment.dataset.ytsrId = cur_elem_id;
				
				const author_name = comment.querySelector('#author-text');
				const comment_content = comment.querySelector('#content-text');

				if (author_name !== null && comment_content !== null) {
					comment.classList.add('ytsr-checking');
					spam_worker.postMessage([cur_elem_id, author_name.innerText, comment_content.innerHTML]);
				}
				
				cur_elem_id += 1;
			}
		}

		// ============
		// Private methods

		static _worker_init() {
			// Get allowed-sites.json and pass it to the worker
			// This needs to happen on the main thread, as xhr.responseType can't be set in a worker

			let xhr = new XMLHttpRequest();
			xhr.responseType = 'arraybuffer';

			xhr.onload = () => {
				YoutubeSpamRemover._log('Onload called');
				
				if (typeof browser === 'undefined') {
					// Can't load panko in webworker in Chrome, so this has to be done here
					let gzipped_data = new Uint8Array(xhr.response);
					let allowed_sites = JSON.parse(pako.inflate(gzipped_data, {to: 'string'}));  /* eslint-disable-line */
					spam_worker.postMessage(['allowed_sites', allowed_sites]);
				
				} else {
					spam_worker.postMessage(['allowed_sites', xhr.response]);
				}
			}

			xhr.onerror = () => {
				YoutubeSpamRemover._log('Error while getting allowed sites list');
			}

			xhr.open('GET', get_ext_url('allowed-sites.json.gz'), true);  /* eslint-disable-line */
			xhr.send();
		}

		static _log(str) {
			if (YoutubeSpamRemover._do_debug_logging) {
				console.debug('YOUTUBE_SPAM_REMOVER :: ' + str);
			}
		}

		// ------
		static _handle_worker_message(event) {
			let [msg_id, is_spam] = event.data;
			let comment_elem = document.querySelector('ytd-comment-renderer[data-ytsr-id="' + msg_id + '"]');

			if (is_spam) {
				comment_elem.dataset.ytsrSpam = '1';
				comment_elem.addEventListener('click', () => {
					comment_elem.classList.toggle('ytsr-display-override');
				});

			} else {
				comment_elem.dataset.ytsrSpam = '0';
			}

			comment_elem.classList.remove('ytsr-checking');
		}
	}

	// ================
	// Initialize

	window.YOUTUBE_SPAM_REMOVER = new YoutubeSpamRemover();
}
