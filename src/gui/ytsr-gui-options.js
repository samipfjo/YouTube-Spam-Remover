const is_chrome = typeof browser === 'undefined';
browser = is_chrome ? chrome : browser;

const storage = is_chrome ? browser.storage.sync : browser.storage.local;

function saveOptions(e) {
	storage.set({
		opennsfw_enabled: document.querySelector("#opennsfw_enabled").checked,
		opennsfw_priming_enabled: document.querySelector("#opennsfw_priming_enabled").checked,
		explain_enabled: document.querySelector("#explain_enabled").checked
	});

	e.preventDefault();

	if (document.querySelector('form span') === null) {
		const checkmark = document.createElement('span');
		const form = document.querySelector('form');
		checkmark.innerText = '✓';
		form.appendChild(checkmark);

		setTimeout(() => { form.removeChild(checkmark) }, 3000);
	}
}

function restoreOptions() {
	const keys_to_get = ['opennsfw_enabled', 'opennsfw_priming_enabled', 'explain_enabled'];
  
	// Only enable OpenNSFW priming if the machine has fairly modern hardware (>= 8 threads)
	const default_priming_state = navigator.hardwareConcurrency >= 8;

	const handler = (res) => {
		document.querySelector("#opennsfw_enabled").checked 		= res.opennsfw_enabled ?? true;
		document.querySelector("#opennsfw_priming_enabled").checked = res.opennsfw_priming_enabled ?? default_priming_state;
		document.querySelector("#explain_enabled").checked 			= res.explain_enabled ?? true;
	};

	if (is_chrome) {
		storage.get(keys_to_get, handler);
	} else {
		storage.get(keys_to_get).then(handler);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	document.querySelector('html').classList.add(is_chrome ? 'chrome' : 'firefox');
	restoreOptions();
});
document.querySelector("form").addEventListener("submit", saveOptions);
