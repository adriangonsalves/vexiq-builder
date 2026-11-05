import json,sys,re,collections
d=json.load(open(sys.argv[1]));a=d["assemblyStructure"];rv=a["rootVersions"]
def M(s):
    v=[float(x) for x in s.split(",")]; return [v[0:4],v[4:8],v[8:12],v[12:16]]
def mul(A,B): return [[sum(A[i][k]*B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]
out=[]
pat=re.compile(r"^(228-\d{4}(-\d{3,4})?)")
def walk(n,PM,top):
    r=n["rootReference"]; m=mul(M(r["transform"]),PM); v=rv.get(r["childVersionId"],{})
    comp=(v.get("versionComponentName") or "").split(" [")[0]
    kids=n.get("children") or []
    mm=pat.match(comp)
    if (mm and not comp.startswith("228-9136-000-")) or not kids:
        out.append(dict(pn=comp,name=r["name"],top=top,hidden=r["hidden"],M=m,
          bb=[v.get(k) for k in ["versionMinX","versionMinY","versionMinZ","versionMaxX","versionMaxY","versionMaxZ"]]))
        return
    for c in kids: walk(c,m,top or r["name"])
for c in a["children"]: walk(c,I,None)
json.dump(out,open(sys.argv[2],"w"))
c=collections.Counter(o["pn"] for o in out)
for k,v in sorted(c.items()): print(v,k)
print(len(out))
