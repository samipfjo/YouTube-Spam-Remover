import glob
import os
import pathlib
import shutil
import zipfile


files = [
    ('', 'src/resources/'),
    ('', 'src/build/'),
    ('yt-spam-remover.css', 'src/yt-spam-remover.css'),
    ('', 'src/extern/'),
    ('gui', 'src/gui/')
]

chrome_build_path = pathlib.Path(f'./Chrome/build/')
shutil.copy(pathlib.Path(f'./Chrome/manifest.json'), chrome_build_path / 'manifest.json');

for browser_folder in ('Chrome', 'Firefox'):
    zip_path = pathlib.Path(f'./{browser_folder}/youtube-spam-remover.zip')

    try: os.remove(zip_path)
    except FileNotFoundError: pass

    extension_zip = zipfile.ZipFile(zip_path, mode='w')

    allowed_sites = 'allowed-sites.json.gz' if browser_folder == 'Chrome' else 'allowed-sites.json'
    extension_zip.write(pathlib.Path(f'./{allowed_sites}'), arcname=allowed_sites)
    
    extension_zip.write(pathlib.Path(f'./{browser_folder}/manifest.json'), arcname='manifest.json')

    for dst, src in files:
        if src.endswith('/'):
            if browser_folder == 'Firefox':
                continue

            # Create the destination path if it doesn't already exist
            if dst != '':
                try:
                    os.mkdir(chrome_build_path / dst)
                except FileExistsError:
                    pass

            # Add all of the files from the specified directory to the files list
            for glob_src in (pathlib.Path(f) for f in glob.glob(f'{src}*.*')):
                files.append((pathlib.Path(dst) / glob_src.name, str(glob_src)))

            continue

        src_path = pathlib.Path(f'./{src}').absolute()
        extension_zip.write(src_path, arcname=dst)

        if browser_folder == 'Chrome':
            shutil.copy2(src_path, chrome_build_path / dst)

    extension_zip.close()
