import base64
import collections
import json
import re


URL_LIMIT = 300000

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
with open('hosts-clean.txt') as f:
    baddies = set([_.rstrip() for _ in f.readlines()])

print('Sorting...')
out = [_ for _ in set(out) - baddies if _.strip() != ''][:URL_LIMIT]
out_dict = collections.defaultdict(list)

for url in out:
    hostname, _, tld = url.rpartition('.')
    out_dict[tld].append(hostname)

for url_list in out_dict.values():
    url_list.sort()

with open('allowed-sites.json', 'w') as f:
    f.write(json.dumps(out_dict, separators=(",", ":")))

input('GZIP the file, then hit enter...')

print('Done!\n')
