"use strict";

/**
 * YouTube Spam Remover
 * 
 * Project homepage: https://github.com/luketimothyjones/youtube-spam-remover/
 *
 * Copyright 2023, Luke Pflibsen-Jones (https://github.com/luketimothyjones)
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
    const browser_entry = (typeof browser === 'undefined' ? chrome : browser);

    browser_entry.runtime.onUpdateAvailable.addListener(function(){
        // Automatically reload the extension when an update is detected
        browser_entry.runtime.reload();
    });
}
