"""
Parse product_link/ folder:
  README.md  → name, price, image_url, product_url
  specs.md   → description, features, packing_list
"""
import re
from pathlib import Path

PRODUCT_LINK_PATH = Path(__file__).parent.parent.parent / 'product_link'


def parse_readme(path: Path) -> dict | None:
    try:
        content = path.read_text(encoding='utf-8')
    except Exception:
        return None

    name_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    if not name_match:
        return None

    price_match = re.search(r'\*\*ราคา/Price:\*\*\s*(THB\S+)', content)
    img_match   = re.search(r'!\[[^\]]*\]\((https?://[^)]+)\)', content)
    url_match   = re.search(r'\[ดูรายละเอียด[^\]]*\]\((https?://[^)]+)\)', content)

    return {
        'name':        name_match.group(1).strip(),
        'price':       price_match.group(1) if price_match else '',
        'image_url':   img_match.group(1)   if img_match   else '',
        'product_url': url_match.group(1)   if url_match   else '',
    }


_SECTION_PATTERNS = {
    'description':  r'\(tab-description\)(.*?)(?=##|\Z)',
    'features':     r'\(tab-feature\)(.*?)(?=##|\Z)',
    'packing_list': r'\(tab-packing-list\)(.*?)(?=##|\Z)',
}


def parse_specs(path: Path) -> dict:
    result = {k: '' for k in _SECTION_PATTERNS}
    try:
        content = path.read_text(encoding='utf-8')
    except Exception:
        return result

    for key, pattern in _SECTION_PATTERNS.items():
        m = re.search(pattern, content, re.DOTALL)
        if m:
            result[key] = m.group(1).strip()

    return result


def build_rag_text(name: str, category: str, subcategory: str, specs: dict) -> str:
    parts = [
        name,
        category,
        subcategory,
        specs.get('description', ''),
        specs.get('features', ''),
    ]
    return ' '.join(p for p in parts if p).strip()


def iter_products():
    """Yield (readme_dict, specs_dict, path) for every product folder."""
    def _order(p: Path) -> int:
        try:
            return int(p.name.split('_', 1)[0])
        except ValueError:
            return 0

    for cat_dir in sorted(PRODUCT_LINK_PATH.iterdir(), key=_order):
        if not cat_dir.is_dir() or cat_dir.name.startswith('.'):
            continue
        for sub_dir in sorted(cat_dir.iterdir(), key=_order):
            if not sub_dir.is_dir() or sub_dir.name.startswith('.'):
                continue
            for prod_dir in sorted(sub_dir.iterdir(), key=_order):
                if not prod_dir.is_dir() or prod_dir.name.startswith('.'):
                    continue
                readme = prod_dir / 'README.md'
                specs  = prod_dir / 'specs.md'
                if not readme.exists():
                    continue
                rd = parse_readme(readme)
                if not rd:
                    continue
                sd = parse_specs(specs) if specs.exists() else {
                    'description': '', 'features': '', 'packing_list': ''
                }
                yield rd, sd, prod_dir
