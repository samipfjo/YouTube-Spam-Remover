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

`use strict`;

const do_debug_logging = false;

// Include GZIP extraction library in Firefox
if (typeof browser !== 'undefined') {
    self.importScripts('pako_inflate.min.js');
}

// ================
// Regular expressions

const host_extractor_re = RegExp('<a' +							// Anchor tag
                                 '(?:(?!href=").)+>' +			// Does not contain href=" (this keeps @name and YouTube links working)
                                 '(?:https?:\/\/)?(?:www\.)?' +	// Discard URL schema
                                 '(?<host>[^ "\n\/\?<]+)',		// Capture the host section (up to but excluding /)
                                 'u');

// Fast ways of determining whether or not the comment should be allowed
const str_contains_emoji_re = /\p{Extended_Pictographic}/u;  // Unicode property escape for pictographic emojis

const allow_by_tld_re = RegExp('^[^\/ ]+' +			    // Discard the domain name and sub-domains
                               '\.(?:edu|gov|mil)' +	// Government and education controlled TLDs
                               '(?:\.[a-z]{2})?$',	    // Country code suffixes (ex: site.gov.uk)
                               'u');

var allowed_sites = null;

onmessage = function(e) {
    if (allowed_sites === null && e.data[0] === 'allowed_sites') {
        // GZIP inflation has to happen on main thread in Chrome
        if (typeof browser === 'undefined') {
            allowed_sites = e.data[1];
            return;

        // Firefox
        } else {
            let gzipped_data = new Uint8Array(e.data[1]);
            allowed_sites = JSON.parse(pako.inflate(gzipped_data, {to: 'string'}));  /* eslint-disable-line */
            return;
        }

    } else if (e.data[0] === 'alive') {
        this.postMessage([true]);
        return;
    }

    let [message_id, author_name, comment_content] = e.data;

    // Hide comments that have an author name that includes emojis.
    if (author_name !== null && str_contains_emoji_re.test(author_name)) {
        log('Found comment with emojis in name: "' + author_name + '"');
        postMessage([message_id, true]);

    // Hide comments that contain an distrusted URL (@ tags are permitted as they have an href attribute)
    } else if (comment_content !== null) {
        const extracted = host_extractor_re.exec(comment_content);

        if (extracted !== null) {
            const host = extracted.groups.host.toLowerCase();

            log('Found URL: "' + host + '"');
            if (host_is_banned(host)) {
                log('Found comment with unapproved URL: "' + host + '"');
                postMessage([message_id, true]);
                return;
            }
        }

        postMessage([message_id, false]);
    }
}

// ------
function host_is_banned(host) {
    return !(allow_by_tld_re.test(host) || allow_by_list(host));
}

// ------
function allow_by_list(host) {
    let last_dot = host.lastIndexOf('.');
    let tld = host.slice(last_dot + 1);
    let rest = host.slice(0, last_dot);

    if (binary_search(tld, rest) > -1) {
        return true;
    }

    return false;
}

// ---
function binary_search(tld, search) {
    let sites_array = allowed_sites[tld];

    // TLD does not exist in allowed sites
    if (typeof sites_array === 'undefined') {
        return -1;
    }

    let left_pos = 0;
    let right_pos = sites_array.length - 1;
    let curr_pos = Math.floor((left_pos + right_pos) / 2);

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

// ------
function log(str) {
    if (do_debug_logging) {
        console.debug('YOUTUBE_SPAM_REMOVER :: ' + str);
    }
}
