#!/bin/sh
# probe_car.sh - run ON THE HEAD UNIT (ssh root@<ip> 'sh -s' < tools/probe_car.sh > probe.txt)
#
# Read-only: lists what the car's own 3D vehicle model and its assets could be, so Sideways can
# load the car's own model at run time (never copied into the repository). Writes nothing, changes
# nothing, stops nothing. Output: the candidate files with sizes, and the first bytes of each kind.
echo "== sideways probe $(date) =="
echo "== system"; uname -a; cat /etc/os-release 2>/dev/null | head -3; df -h 2>/dev/null | head -20
echo "== iDrive generation (what platform/idrive.js reads)"
for f in /etc/os-release /etc/version /etc/sw_version /etc/hostname /etc/issue /proc/device-tree/model /etc/hu_variant /etc/build_info /opt/sys/etc/version /var/opt/sys/hu_info; do
  [ -r "$f" ] && { echo "-- $f"; head -c 600 "$f" | tr -d '\000'; echo; }
done
echo "== HMI processes"; ps -eo pid,comm,args 2>/dev/null | grep -i -E "hmi|ramses|kanzi|render|cluster|vehicle" | grep -v grep | head -30
echo "== 3D asset files by extension (largest first)"
find / -xdev \( -iname '*.ramses' -o -iname '*.rres' -o -iname '*.rlogic' -o -iname '*.res' -o -iname '*.kzb' -o -iname '*.kzp' \
  -o -iname '*.glb' -o -iname '*.gltf' -o -iname '*.fbx' -o -iname '*.obj' -o -iname '*.dae' -o -iname '*.mesh' -o -iname '*.3ds' \
  -o -iname '*.pvr' -o -iname '*.ktx' -o -iname '*.astc' \) -type f 2>/dev/null | xargs -r ls -laS 2>/dev/null | head -150
echo "== folders that look like vehicle models"
find / -xdev -type d 2>/dev/null | grep -i -E "vehicle|car_?model|3d|carmodel|exterior|paint|lack|body" | grep -v -E "^/proc|^/sys" | head -150
echo "== files named after model codes or paints (G2x, G8x, F4x, G0x)"
find / -xdev -type f 2>/dev/null | grep -i -E "/(g[0-9]{2}|f[0-9]{2}|i[0-9]{2})[_./-]" | head -100
echo "== RAMSES / Kanzi libraries"
find / -xdev \( -iname 'libramses*' -o -iname 'libkanzi*' -o -iname '*rlogic*' \) 2>/dev/null | head -20
echo "== magic bytes of the biggest candidates"
find / -xdev \( -iname '*.ramses' -o -iname '*.rres' -o -iname '*.res' -o -iname '*.kzb' -o -iname '*.glb' \) -type f -size +200k 2>/dev/null | head -12 | while read f; do
  printf '%s  ' "$f"; head -c 32 "$f" | od -An -c | tr -s ' ' | head -2 | tr '\n' ' '; echo
done
echo "== done"
