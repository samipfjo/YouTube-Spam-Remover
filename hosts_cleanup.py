import re


with open('hosts.txt') as f:
    data = f.read()

data = re.sub(r'\r|\t|www\.', '', data, flags=re.MULTILINE)
data = re.sub(r'#.+$', '', data, flags=re.MULTILINE)
data = re.sub(r'^.+ (?P<url>.+)$', r'\1', data, flags=re.MULTILINE)
data = data[data.find('0.0.0.0\n') + 9:]
data = re.sub(r' +$', '', data, flags=re.MULTILINE)
data = re.sub(r'^#?\n', '', data, flags=re.MULTILINE)

with open('hosts-clean.txt', 'w') as f:
    f.write('\n'.join(sorted(data.split('\n')))[1:])
    f.write('\n')
