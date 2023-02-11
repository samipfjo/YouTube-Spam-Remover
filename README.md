# YouTube Spam Remover
 A browser extension that vastly reduces the amount of spam in YouTube comments using a variety of techniques

[Install Firefox version here](https://addons.mozilla.org/en-US/firefox/addon/youtube-spam-remover/)

[Install Chrome version here](https://chrome.google.com/webstore/detail/youtube-spam-remover/gmlbmlpbijkhcdhfaaimaehgjfjccffd)

<br>

## Technical details

### Defacto allows
By default, the following types of comments are allowed, ignore the below filters:
 - The video author's comments
 - The video's pinned comment
 - Verified (checkmark) YouTube accounts

### Phrases
I manually assembled some commonly used phrases from spam comments, which act as a first line of defense.

### Spoofers
Scammers pretending to be the video author are detected using a slightly modified version of [Mapbox's pixelmatch library](https://github.com/mapbox/pixelmatch).

### NSFW detection
NSFW detection is handled by [my JavaScript port](https://github.com/lukepfjo/OpenNSFW.js) of Yahoo's OpenNSFW model. It's the most accurate (and least biased) NSFW classifier I could find, so I ported it for use in this extension. This can be disabled in the extension's option page if you desire.

### Allowed sites
Comments containing websites that are not in our allowed sites list are marked as spam out of an abundance of caution. Below are the steps used to generate this list.

First, the list of allowed websites is retrieved from the [Tranco project](https://tranco-list.eu/) using these filters:
 - Lists: Alex, Cisco Umbrella, Majestic
 - Number of days: last 30
 - Combination method: Dowdall rule
 - Aggregate from full list
 - Only include pay-level domains
 - No TLD filtering
 - Output length: 1 millon

 [See the latest Tranco list here](https://tranco-list.eu/list/GZ8VK/1000000)

Second, we remove the TLDs [*.edu](https://icannwiki.org/.edu), [*.gov](https://icannwiki.org/.gov), and [*.mil](https://icannwiki.org/.mil), as we blanket-allow them since registration requires approval from a regulatory organization.

Third, we remove domains containing "bride," "dating," and "viagra," as they are massively present in spam URLs. The hope with "bride" is that most valid URLs will use "bridal" instead.

Fourth, we remove domains that are present in [StephenBlack's hosts file](https://github.com/StevenBlack/hosts), which is a collection of known bad sites.

Fifth, we limit the list to the top 300,000 to save space and lessen the chance of malicious URLs slipping through our filters.

Lastly, we add some known good domains (like the Linus Tech Tips store that gets memed on a lot) to the list. If a YouTuber's legitimate domain gets flagged falsely, consider submitting a pull request to add it to the allow list.

### Known spammers
Once one of a user's comments is marked as spam, all subsequent comments by that user are marked as spam.
