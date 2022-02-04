import collections
import json
import re
import subprocess


URL_LIMIT = 300000

# Clean up hosts data
with open('hosts.txt') as f:
    hosts_data = f.read()

hosts_data = re.sub(r'\r|\t|www\.', '', hosts_data, flags=re.MULTILINE)
hosts_data = re.sub(r'#.+$', '', hosts_data, flags=re.MULTILINE)
hosts_data = re.sub(r'^.+ (?P<url>.+)$', r'\1', hosts_data, flags=re.MULTILINE)
hosts_data = hosts_data[hosts_data.find('0.0.0.0\n') + 9:]
hosts_data = re.sub(r' +$', '', hosts_data, flags=re.MULTILINE)
hosts_data = re.sub(r'^#?\n', '', hosts_data, flags=re.MULTILINE)

known_bad_urls = set(sorted(hosts_data.split('\n'))[1:])


# Clean up tranco data
with open('tranco_custom.csv') as f:
    tranco_data = f.read()

print('Cleaning data...')

# Data cleanup
tranco_data = tranco_data.replace('\r', '')
tranco_data = re.sub(r'^\d+,', '', tranco_data, flags=re.MULTILINE)
tranco_data = re.sub(r'^.+\.\w+-+\w*\n', '', tranco_data, flags=re.MULTILINE)

# Remove unwanted URLs (edu|gov|mil are allowed already)
tranco_data = re.sub(r'^.+\.(?:edu|gov|mil)(?:\.\w\w)?\n', '', tranco_data, flags=re.MULTILINE)

# Remove common spam items
tranco_data = re.sub(r'^.*(?:bride|dating|viagra).*\n', '', tranco_data, flags=re.MULTILINE)

print('De-duplicating data...')

already_added = set()
out = []
for url in tranco_data.split('\n'):
    url = url.rstrip()

    if url in already_added:
        continue

    out.append(url)
    already_added.add(url)

already_added.clear()

print('Removing known bad actors...')

# Remove known bad hosts urls from tranco list
out = [_ for _ in out if _.strip() != '' and _ not in known_bad_urls][:URL_LIMIT]
out_dict = collections.defaultdict(list)

# Add known good hosts
with open('known-urls.txt') as f:
    known_urls = f.readlines()
    out += [_.strip() for _ in known_urls if _.strip() != '']

print('Sorting...')
for url in out:
    hostname, _, tld = url.rpartition('.')
    out_dict[tld].append(hostname)

for url_list in out_dict.values():
    url_list.sort()

with open('allowed-sites.json', 'w') as f:
    f.write(json.dumps(out_dict, separators=(",", ":")))

print('GZIPing allowed-sites.json...')
subprocess.run(r'"C:/Program Files/7-Zip/7z.exe" a "./allowed-sites.json.gz" "./allowed-sites.json"')

print('Done!\n')
