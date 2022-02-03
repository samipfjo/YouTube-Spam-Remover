import collections
import json
import re
import subprocess


URL_LIMIT = 300000

# Clean up hosts data
with open('hosts.txt') as f:
    data = f.read()

data = re.sub(r'\r|\t|www\.', '', data, flags=re.MULTILINE)
data = re.sub(r'#.+$', '', data, flags=re.MULTILINE)
data = re.sub(r'^.+ (?P<url>.+)$', r'\1', data, flags=re.MULTILINE)
data = data[data.find('0.0.0.0\n') + 9:]
data = re.sub(r' +$', '', data, flags=re.MULTILINE)
data = re.sub(r'^#?\n', '', data, flags=re.MULTILINE)

known_bad_urls = set(sorted(data.split('\n'))[1:])


# Clean up tranco data
known = set()
out = []

with open('tranco_custom.csv') as f:
    data = f.read() 

print('Cleaning data...')

# Data cleanup
data = data.replace('\r', '')
data = re.sub(r'^\d+,', '', data, flags=re.MULTILINE)
data = re.sub(r'^.+\.\w+-+\w*\n', '', data, flags=re.MULTILINE)

# Remove unwanted URLs (edu|gov|mil are allowed already)
data = re.sub(r'^.+\.(?:edu|gov|mil)(?:\.\w\w)?\n', '', data, flags=re.MULTILINE)
data = re.sub(r'^.*(?:bride|dating|viagra).*\n', '', data, flags=re.MULTILINE)

print('De-duplicating data...')
for url in data.split('\n'):
    url = url.rstrip()

    if url in known:
        continue

    out.append(url)
    known.add(url)

known.clear()

print('Removing known bad actors...')

# Remove known bad hosts urls from tranco list
out = [_ for _ in out if _.strip() != '' and _ not in known_bad_hosts][:URL_LIMIT]
out_dict = collections.defaultdict(list)

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
