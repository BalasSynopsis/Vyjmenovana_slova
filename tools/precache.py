"""Write precache-manifest.js listing every shipped file + a content hash as version.
Run from repo root after any change: python3 tools/precache.py"""
import hashlib, json, os
SHIP = ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest']
DIRS = ['content', 'assets']
files = list(SHIP)
for d in DIRS:
    for root, _, fs in os.walk(d):
        for f in sorted(fs):
            if f.endswith(('.json', '.webp', '.png', '.mp3', '.woff2')):
                files.append(os.path.join(root, f).replace(os.sep, '/'))
h = hashlib.sha256()
for f in files: h.update(f.encode()); h.update(open(f, 'rb').read())
out = {'version': h.hexdigest()[:10], 'files': ['./'] + files}
open('precache-manifest.js', 'w').write('self.PRECACHE = ' + json.dumps(out, indent=1) + ';\n')
print(out['version'], len(files), 'files')
