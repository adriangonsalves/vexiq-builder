#!/bin/bash
# inserttry.sh <partQuery> <label> <targetLabel> <targetPort> <sourcePort>: try rolls/flips one call each, keep clean ones with seat scores
cd "$(dirname "$0")/.."
node scripts/mcpcall.mjs get_assembly empty.json asm.json > /dev/null
tid=$(node -e 'console.log(require("./asm.json").instances.find(x=>x.label===process.argv[1]).instanceId)' "$3")
echo '{"label":"'"$2"'","partQuery":"'"$1"'","cands":[]}' > cands.json
for flip in false true; do for r in $(seq 0 15 345); do
  echo '{"dryRun":true,"verbose":true,"parts":[{"partQuery":"'"$1"'","label":"CAND","insert":{"into":{"instanceId":"'"$tid"'","port":"'"$4"'"},"sourcePort":"'"$5"'","flip":'$flip',"rollDeg":'$r'}}]}' > dry.json
  node scripts/mcpcall.mjs place_parts dry.json dryout.json > /dev/null
  node -e 'const o=require("./dryout.json");const c=require("./cands.json");const p=o.parts?.[0];if(p?.position)c.cands.push({flip:process.argv[1],roll:+process.argv[2],position:p.position,rotation:p.rotation,ext:p.overlaps||[]});require("fs").writeFileSync("cands.json",JSON.stringify(c))' $flip $r
done; done
node scripts/seatscore.mjs asm.json cands.json > /dev/null
node -e 'const c=require("./cands.json");console.log(c.label, c.cands.map(x=>`f${x.flip[0]}r${x.roll}:s${x.seated}${x.ext.length?"x":""}`).join(" "))'
