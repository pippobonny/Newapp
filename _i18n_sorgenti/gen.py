import json,os,re
def parse(fn,strip=True):
    out=[]
    for line in open(fn,encoding='utf8'):
        line=line.rstrip('\n')
        if not line or ' ⇒ ' not in line: continue
        a,b=line.split(' ⇒ ',1)
        if strip: a,b=a.strip(),b.strip()
        out.append((a,b))
    return out
ex=parse('en_exact.txt')+parse('en_raw_t.txt',False); fr=parse('en_frag.txt',False); pa=parse('en_patterns.txt')
d={}
for a,b in ex:
    if a in d and d[a]!=b: print('DUP',a)
    d[a]=b
fr.sort(key=lambda x:-len(x[0]))
js='/* Dizionario italiano -> inglese (britannico) per seeva. Generato da\n   Claude, 2026-10-07. Chiave = testo italiano esattamente come compare\n   nell\'app (spazi ai bordi esclusi). Vedi i18n.js per come viene usato.\n   - SEEVA_EN: frasi intere;\n   - SEEVA_EN_FRAGS: pezzi di frase attorno a nomi/numeri (sostituiti dentro\n     il testo, dal più lungo al più corto);\n   - SEEVA_EN_PATTERNS: espressioni regolari per i casi rimanenti. */\n'
js+='(function () {\n  var D = window.SEEVA_EN = window.SEEVA_EN || {};\n  var src = '+json.dumps(d,ensure_ascii=False,indent=1)+';\n  for (var k in src) D[k] = src[k];\n'
js+='  window.SEEVA_EN_FRAGS = '+json.dumps(fr,ensure_ascii=False)+';\n'
js+='  var P = window.SEEVA_EN_PATTERNS = window.SEEVA_EN_PATTERNS || [];\n'
for a,b in pa: js+='  P.push([new RegExp('+json.dumps(a,ensure_ascii=False)+'), '+json.dumps(b,ensure_ascii=False)+']);\n'
js+='})();\n'
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'i18n-en.js'),'w',encoding='utf8').write(js)
print(len(d),len(fr),len(pa))
