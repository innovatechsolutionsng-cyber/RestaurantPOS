from pathlib import Path
p = Path('server.js')
s = p.read_text(encoding='utf-8')
lines = s.splitlines()
new_lines = []
for i,line in enumerate(lines):
    if 'adminDatabase' in line:
        # skip this line
        continue
    # skip orphan else lines that are just '}' or 'else {' with nothing else? We'll remove lines that are only 'else {' or '} else {'
    if line.strip() in ('else {', '} else {'):
        continue
    new_lines.append(line)
new = '\n'.join(new_lines)
# backup
bak = p.with_suffix('.server.js.bak')
if not bak.exists():
    bak.write_text(s, encoding='utf-8')
p.write_text(new, encoding='utf-8')
print('Done. Remaining adminDatabase occurrences:', new.count('adminDatabase'))
