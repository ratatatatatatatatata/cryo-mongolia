"""Read-only public copy inventory. Never reads admin, config or database files."""
from html.parser import HTMLParser
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parent.parent
PAGES = ['index.html', 'hub.html', 'cabin.html', 'xcryo.html', 'oxypro.html', 'ledpro.html', 'privacy.html', 'data-deletion.html']
class CopyParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.strings = []
    def add(self, text):
        text = ' '.join(text.split())
        if re.search('[А-Яа-яӨөҮүЁё]', text): self.strings.append(text)
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.skip += 1
        if self.skip: return
        attrs = dict(attrs)
        for key in ('alt', 'title', 'placeholder', 'aria-label', 'label'):
            if attrs.get(key): self.add(attrs[key])
        if tag == 'meta' and attrs.get('name', attrs.get('property')) in ('description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'):
            self.add(attrs.get('content', ''))
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'): self.skip = max(0, self.skip - 1)
    def handle_data(self, text):
        if not self.skip: self.add(text)

def inventory(pages=PAGES):
    result = {}
    for page in pages:
        parser = CopyParser()
        parser.feed((ROOT / page).read_text())
        for text in parser.strings: result.setdefault(text, []).append(page)
    return result

if __name__ == '__main__':
    data = inventory(sys.argv[1:] or PAGES)
    for i, text in enumerate(data): print(json.dumps(text, ensure_ascii=False))
