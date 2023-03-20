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

declare var pixelmatch: Function;
declare var DecompressionStream: ObjectConstructor;

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

	// These are just the defaults; the real config is sent over at runtime by the main thread
	var YTSRConfig = {
		log_level: LogLevel.Off,
		pixel_match_threshold: 100,
		opennsfw_threshold: .21,
		explain_spam: true,
		do_nsfw_checking: true,
		do_priming: true
	};

	// ================
	// Regular expressions

	const forbidden_phrases_re = RegExp([
		'full clip',
		'this is where i met',
		'here is where i met',
		'i upload( funny)?( entertaining)? videos',
		'i make videos like',
		'commented on my (recent )?video',
		'my banner',
		'my pfp',
		'my profile',
		'(message|msg|text) me on telegram'
	].join('|'), 'u');

	const host_extractor_re = RegExp('<a' +							// Anchor tag
									'(?:(?!href=").)+>' +			// Does not contain href=" (this keeps @name and YouTube links working)
									'(?:https?:\/\/)?(?:www\.)?' +	// Discard URL schema
									'(?<host>[^ "\n\/\?<]+)',		// Capture the host section (up to but excluding /)
									'u');

	// Fast way of determining whether or not the comment should be allowed
	const allow_by_tld_re = RegExp('^[^\/ ]+' +				// Discard the domain name and sub-domains
								'\.(?:edu|gov|mil)' +	// Government and education controlled TLDs
								'(?:\.[a-z]{2})?$',		// Country code suffixes (ex: site.gov.uk)
								'u');


	var allowed_sites: object | null = null;

	var video_owner_avatar_promise: Promise<ImageData> | null = null;
	var video_owner_avatar: ImageData | null = null;
	const avatar_width: number = 48;
	const avatar_height: number = 48;

	const banned_user_handles = new Set<string>();

	var OpenNSFW: ObjectConstructor;
	var opennsfw: Object | null = null;
	var prime_called: boolean = false;


	// ================
	function make_logger(this: void, log_level: number, prefix: string): {'basic': Function, 'verbose': Function} {
		return {
			basic:   log_level >= 1 ? globalThis.console.debug.bind(this, prefix) : () => {},
			verbose: log_level >= 2 ? globalThis.console.debug.bind(this, prefix) : () => {}
		}
	}

	var logger: any = make_logger(YTSRConfig.log_level, 'YOUTUBE_SPAM_REMOVER (worker) ::');


	// ================
	onmessage = async function(e: MessageEvent) {
		const command: string = e.data[0];

		// Handle receipt of allowed_sites.json from main thread
		if (allowed_sites === null && command === 'allowed_sites') {
			const allowed_sites_data = e.data[1];

			// Use native compression stream API; not yet supported in Firefox
			if (typeof DecompressionStream !== 'undefined' && allowed_sites_data[0] !== '{') {
				logger.verbose('Using DecompressionStream method for allowed-sites ungzipping');

				const decompressor = new DecompressionStream('gzip');
				const stream = allowed_sites_data.stream().pipeThrough(decompressor);

				// Handy way to turn a JSON stream into an object
				allowed_sites = await new Response(stream).json();

			// Firefox
			} else {
				allowed_sites = JSON.parse(allowed_sites_data);
			}

			return;

		} else if (command === 'config') {
			YTSRConfig = e.data[1];
			logger = make_logger(YTSRConfig.log_level, 'YOUTUBE_SPAM_REMOVER (worker) ::');
			return;

		} else if (opennsfw === null && command === 'script_urls') {
			logger.verbose('Importing scripts');

			importScripts(e.data[1][0]);  // import pixelmatch

			if (YTSRConfig.do_nsfw_checking) {
				importScripts(e.data[1][1]);  // import opennsfw
				opennsfw = new OpenNSFW();
				(opennsfw as any).load().then(() => postMessage(['opennsfw_loaded', 'opennsfw_loaded']));

			} else {
				opennsfw = false;
			}

			return;

		} else if (command === 'video_owner_avatar') {
			logger.verbose(`Getting imagedata for video author (${e.data[1]})`);

			video_owner_avatar_promise = imageToImageData(e.data[1]);
			video_owner_avatar_promise.then((imagedata: ImageData) => {
				video_owner_avatar = imagedata;
				logger.verbose('Got imagedata for video author');
			});
			return;
		}

		if (YTSRConfig.do_nsfw_checking && command === 'video_playing') {
			primeOpenNSFW();
			return;
		}

		judgeSpam(e.data);
	}

	// ------
	async function judgeSpam(data: [string, any, string, string]) {
		const [comment_id, user_handle, comment_content, author_image_src] = data;

		if (comment_content === null || typeof comment_content === 'undefined') {
			logger.basic(`WARN: Comment #${comment_id} was passed with missing text content`);

		// Hide comments that contain an distrusted URL (@ tags are permitted as they have an href attribute)
		} else {
			const extracted = host_extractor_re.exec(comment_content);

			if (extracted !== null) {
				const host = (extracted as any).groups.host.toLowerCase();

				logger.verbose(`Found URL: "${host}"`);
				if (checkBanStatus(host)) {
					logger.basic(`Comment #${comment_id} has unapproved URL: "${host}"`);
					postMessage([comment_id, SpamType.URL]);
					banned_user_handles.add(user_handle);
					return;
				}
			}

			if (banned_user_handles.has(user_handle)) {
				logger.basic(`Comment by ${user_handle} previously marked as spam; assuming spammer`);
				postMessage([comment_id, SpamType.AlreadySeen]);
				return;
			}

			if (typeof comment_content !== 'undefined' && containsForbiddenPhrases(comment_content)) {
				logger.basic(`Comment #${comment_id} contains forbidden phrase`);
				postMessage([comment_id, SpamType.Text]);
				banned_user_handles.add(user_handle);
				return;
			}

			postMessage(['content_ok', comment_id]);
		}

		if (author_image_src !== null) {
			logger.verbose(`Getting imagedata for comment #${comment_id}`);
			const author_image_imagedata = await imageToImageData(author_image_src);

			// Check if the comment's avatar is a duplicate of the video author's avatar
			const pixel_diff = await compareAvatars(author_image_imagedata as ImageData);

			if (pixel_diff < YTSRConfig.pixel_match_threshold) {
				logger.basic(`Comment #${comment_id} has identical avatar to video author (less than 100px difference) -- assumed scammer`);
				postMessage([comment_id, SpamType.Imposter]);
				banned_user_handles.add(user_handle);
				return;

			} else {
				logger.verbose(`Comment #${comment_id} has different avatar than video author`);
			}

			// Skip NSFW check if configured not to run it
			if (!YTSRConfig.do_nsfw_checking) {
				postMessage([comment_id, SpamType.None]);
				return;
			}

			const [is_nsfw, nsfw_confidence] = await runOpenNSFW(comment_id, author_image_imagedata as ImageData);
			if (is_nsfw) {
				logger.basic(`OpenNSFW thinks comment #${comment_id} is NSFW (confidence: nsfw=${nsfw_confidence}%)`);
				banned_user_handles.add(user_handle);
				postMessage([comment_id, SpamType.OpenNSFW]);
				return;

			} else {
				logger.verbose(`OpenNSFW thinks comment #${comment_id} is SFW (confidence: nsfw=${nsfw_confidence}%)`);
			}
		}
		
		postMessage([comment_id, SpamType.None]);
	}

	// ------
	function checkBanStatus(host: string) {
		if (allow_by_tld_re.test(host)) {
			return false;
		}

		const last_dot = host.lastIndexOf('.'),
		tld = host.slice(last_dot + 1),
		rest = host.slice(0, last_dot);

		if (binarySearch(tld, rest) > -1) {
			return true;
		}

		return false;
	}

	// ------
	function containsForbiddenPhrases(comment_content: string) {
		let normalized = comment_content.toLowerCase();
		return forbidden_phrases_re.exec(normalized) !== null;
	}

	// ------
	async function compareAvatars(test_avatar_imagedata: ImageData): Promise<number> {
		await video_owner_avatar_promise;

		return pixelmatch((video_owner_avatar as ImageData).data,
						test_avatar_imagedata.data,
						null,
						avatar_width, avatar_height,
						{ threshold: 0.1, diffMax: YTSRConfig.pixel_match_threshold });
	}

	// ------
	async function primeOpenNSFW(): Promise<void> {
		if (!opennsfw) {
			logger.basic('Attempt made to use OpenNSFW before the object was initialized!');
			return;
		}

		if (prime_called) {
			logger.verbose('A duplicate attempt was made to prime OpenNSFW');
			return;
		}

		prime_called = true;

		if (!(opennsfw as any).isLoaded()) {
			logger.verbose('Worker awaiting Promise for OpenNSFW model load... (prime_opennsfw)');
			await (opennsfw as any).getLoadPromise();
			logger.verbose('Promise for OpenNSFW model load resolved (prime_opennsfw)');
		}

		logger.verbose('Priming OpenNSFW');
		await (opennsfw as any).prime();
		return;
	}

	// ------
	async function runOpenNSFW(comment_id: string, author_image_imagedata: ImageData): Promise<[string, string]> {
		if (YTSRConfig.do_nsfw_checking && !(opennsfw as any).isLoaded()) {
			logger.verbose('Worker awaiting Promise for OpenNSFW model load... (run_opennsfw)');
			await (opennsfw as any).getLoadPromise();
			logger.verbose('Promise for OpenNSFW model load resolved (run_opennsfw)');
		}

		return new Promise(async (resolve, reject) => {
			logger.verbose(`OpenNSFW has been sent #${comment_id}`);

			const result = await (opennsfw as any).classifyImages(author_image_imagedata);

			if (!result || typeof result.is_nsfw === 'undefined') {
				reject([null, 'OpenNSFW returned an undefined result']);
			} else {
				resolve([result.is_nsfw, result.nsfw_confidence]);
			}
		});
	}

	// ------
	async function imageToImageData(image_src: string): Promise<ImageData> {
		return new Promise(async (resolve, reject) => {
			// Unfortunately we cannot use the image directly due to security protections

			let image_response: Response | null = null;
			try {
				image_response = await fetch(image_src);

			} catch (error: any) {
				if (error.name === 'NetworkError') {
					console.error(error.message);
					reject();
					return;

				} else {
					throw error;
				}
			}

			const image_blob = await image_response.blob();
			const bitmap = await createImageBitmap(image_blob);

			const canvas = new OffscreenCanvas(avatar_width, avatar_height);
			const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
			context.drawImage(bitmap, 0, 0, avatar_width, avatar_height);

			resolve(context.getImageData(0, 0, avatar_width, avatar_height));
		});
	}

	// ------
	function binarySearch(tld: string, search: string): number {
		if (allowed_sites === null) {
			logger.basic('WARN: Attempted to search allowed sites list before it was loaded!');
			return -1;
		}

		const sites_array = allowed_sites[tld];

		// TLD does not exist in allowed sites
		if (typeof sites_array === 'undefined') {
			return -1;
		}

		let left_pos = 0,
			right_pos = sites_array.length - 1,
			curr_pos = Math.floor((left_pos + right_pos) / 2);

		while (left_pos < right_pos) {
			let curr_val = sites_array[curr_pos];

			if (search < curr_val){
				right_pos = curr_pos - 1;

			} else if (search > curr_val){
				left_pos = curr_pos + 1;

			} else {
				return curr_pos;
			}

			curr_pos = Math.floor((left_pos + right_pos) / 2);
		}

		return -1;
	}
}
