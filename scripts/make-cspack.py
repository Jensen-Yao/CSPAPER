# 打包桌面端导出格式的测试 .cspack（STORE zip：library.json + pdfs/）
# 用法: python scripts/make-cspack.py <示例库根目录> <输出.cspack>
import json, os, sys, zipfile

src = sys.argv[1] if len(sys.argv) > 1 else 'F:/tmp/cspaper-sample/papers'
out = sys.argv[2] if len(sys.argv) > 2 else 'F:/tmp/cspaper-sample/sample.cspack'

papers, pdf_entries = [], []
for cat in sorted(os.listdir(src)):
    catdir = os.path.join(src, cat)
    if not os.path.isdir(catdir):
        continue
    for slug in sorted(os.listdir(catdir)):
        d = os.path.join(catdir, slug)
        pdf = os.path.join(d, 'paper.pdf')
        md = os.path.join(d, slug + '.md')
        if not os.path.isfile(pdf):
            continue
        meta = {'title': slug, 'authors': '', 'year': None, 'venue': '', 'category': cat, 'slug': slug, 'status': 'unread', 'pdf': f'pdfs/{slug}.pdf'}
        if os.path.isfile(md):
            for line in open(md, encoding='utf-8'):
                line = line.strip()
                if line.startswith('title:'):
                    meta['title'] = line.split(':', 1)[1].strip().strip('"')
                elif line.startswith('authors:'):
                    meta['authors'] = line.split(':', 1)[1].strip().strip('"')
                elif line.startswith('year:'):
                    try:
                        meta['year'] = int(line.split(':', 1)[1].strip())
                    except ValueError:
                        pass
                elif line.startswith('venue:'):
                    meta['venue'] = line.split(':', 1)[1].strip().strip('"')
        pdf_entries.append((pdf, meta['pdf']))
        papers.append(meta)

manifest = {'format': 1, 'app': 'CSPAPER', 'exportedAt': 'demo', 'papers': papers, 'highlights': []}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    z.writestr('library.json', json.dumps(manifest, ensure_ascii=False, indent=1))
    for pdf, arc in pdf_entries:
        z.write(pdf, arc)
print(f'cspack OK: {len(papers)} 篇 → {out} ({os.path.getsize(out) // 1024} KB)')
