import os
import pathlib


files = [
    (r'allowed-sites.json.gz', r'allowed-sites.json.gz'),
    (r'icon128.png', r'src\icon128.png'),
    (r'icon48.png', r'src\icon48.png'),
    (r'icon16.png', r'src\icon16.png'),
    (r'pako_inflate.min.js', r'src\extern\pako_inflate.min.js'),
    (r'yt-spam-remover-worker.js', r'src\yt-spam-remover-worker.js'),
    (r'yt-spam-remover.css', r'src\yt-spam-remover.css'),
    (r'yt-spam-remover.js', r'src\yt-spam-remover.js')
]

for browser_folder in ('Chrome', 'Firefox'):
    for dst, src in files:
        try:
            os.link(pathlib.Path(f'.\\{src}'),
                    pathlib.Path(f'.\\{browser_folder}\\{dst}'))

        except FileExistsError:
            print(f'{browser_folder}/{dst} already exists')
