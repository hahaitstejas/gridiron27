#!/bin/bash
# run.sh <human.json> <prefix> [pad] [lower]  (env BUILDS="WR:0,OL:0.35")
REPO=${REPO:-$(pwd)}
D=${OUT:-/tmp/g27shots}; mkdir -p $D
cd $D && timeout 280 blender -b --factory-startup -P "$REPO/tools/blender/preview.py" -- "$1" "$D/$2" ${3:-1.3} ${4:-1.0} 2>&1 | grep -E "DONE|Error|Traceback|File" | head
ffmpeg -v error -y -i $D/$2_front.png -i $D/$2_q34.png -i $D/$2_side.png -i $D/$2_back.png -filter_complex "[0][1]vstack[a];[2][3]vstack[b];[a][b]hstack,scale=1800:-1" $D/$2_all.png && echo $D/$2_all.png
