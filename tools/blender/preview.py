# Clay-with-colors turnaround of the game body (src/assets/human.json) in bind pose for several builds, headless:
#   blender -b --factory-startup -P tools/blender/preview.py -- src/assets/human.json out/prefix [pad=1.3] [lower=1]   (env BUILDS="WR:0.07,OL:0.93")
# Same shape maths as render/body.js buildPos, so body changes can be judged in 12 s without the browser. Needs `apt install blender`.
import bpy, sys, json, base64, struct, math, array
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, prefix = argv[0], argv[1]
PAD = float(argv[2]) if len(argv) > 2 else 1.3
LOWER = float(argv[3]) if len(argv) > 3 else 1.0   # 1.0 = in-game lower-body taper maths, 0 = none
h = json.load(open(src))
n = h['count']
def dec(key, fmt, sz):
    b = base64.b64decode(h[key]); return struct.unpack('<%d%s' % (len(b) // sz, fmt), b)
P = dec('position', 'f', 4); BK = dec('bulk', 'f', 4); PD = dec('pad', 'f', 4)
IDX = dec('index', 'H', 2); REG = dec('region', 'B', 1)
def smooth(a, b, x):
    t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def shape(i, bulk, pad):
    x, y, z = P[3*i:3*i+3]
    lower = smooth(1.08, 1.24, 1.0 - 0) if False else None
    # shader: lower = smoothstep(1.24, 1.08, y)  (1 below 1.08, 0 above 1.24)
    t = min(1, max(0, (y - 1.24) / (1.08 - 1.24))); lw = t * t * (3 - 2 * t)
    lw *= LOWER
    q = [x + BK[3*i]*bulk + PD[3*i]*pad, y + BK[3*i+1]*bulk + PD[3*i+1]*pad, z + BK[3*i+2]*bulk + PD[3*i+2]*pad]
    tt = lw * smooth(0.32, 0.6, y)
    cx = 0.105 * max(-1, min(1, q[0] / 0.05))
    q[0] = cx + (q[0] - cx) * (1 - 0.2 * tt)
    q[2] = (-0.03 + (q[2] + 0.03) * (1 - 0.4 * tt)) if q[2] < -0.03 else q[2] * (1 - 0.08 * tt)
    return q
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# colors per region: jersey, sleeve, pants, stripe, socks, skin, forearm, gloves, shoe
def mk(jer, pan, trim, skin):
    return [jer, jer, pan, trim, trim, skin, skin, pan, (0.03, 0.03, 0.03)]
TEAM_A = mk((0.92, 0.92, 0.92), (0.92, 0.92, 0.92), (0.1, 0.1, 0.45), (0.55, 0.38, 0.28))
TEAM_B = mk((0.1, 0.12, 0.38), (0.9, 0.9, 0.9), (0.9, 0.35, 0.1), (0.35, 0.22, 0.16))
import os
spec = os.environ.get('BUILDS', 'WR:0,QB:0.1,LB:0.22,OL:0.35')
builds = [(a.split(':')[0], float(a.split(':')[1]), TEAM_B if k % 2 == 0 else TEAM_A) for k, a in enumerate(spec.split(','))]
mat = bpy.data.materials.new('vc'); mat.use_nodes = True
nt = mat.node_tree
for nd in list(nt.nodes):
    if nd.type != 'OUTPUT_MATERIAL': nt.nodes.remove(nd)
vcn = nt.nodes.new('ShaderNodeVertexColor'); vcn.layer_name = 'c'
bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); bs.inputs['Roughness'].default_value = 0.7
nt.links.new(vcn.outputs['Color'], bs.inputs['Base Color'])
nt.links.new(bs.outputs['BSDF'], [x for x in nt.nodes if x.type == 'OUTPUT_MATERIAL'][0].inputs['Surface'])
ROT = 0.0
for k, (name, bulk, cols) in enumerate(builds):
    verts = [shape(i, bulk, PAD) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([(v[0], -v[2], v[1]) for v in verts], [], [tuple(IDX[j:j+3]) for j in range(0, len(IDX), 3)])
    me.update()
    ca = me.color_attributes.new('c', 'FLOAT_COLOR', 'POINT')
    for i in range(n): ca.data[i].color = (*cols[min(REG[i], 8)], 1)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    ob.location = (k * 1.15 - (len(builds) - 1) * 0.575, 0, 0)
    ob.rotation_euler = (0, 0, ROT)
    for p in me.polygons: p.use_smooth = True
    me.materials.append(mat)
# lighting + camera
bpy.ops.object.light_add(type='SUN', location=(3, -5, 8)); sun = bpy.context.object; sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.ops.object.light_add(type='SUN', location=(-4, -3, 4)); f = bpy.context.object; f.data.energy = 1.2; f.rotation_euler = (math.radians(70), 0, math.radians(-60))
w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.42, 0.45, 0.5, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
scene.world = w
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 24; scene.cycles.use_denoising = False
scene.render.resolution_x = 1400; scene.render.resolution_y = 700
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 4.6
cam.location = (0, -10, 1.0); cam.rotation_euler = (math.pi/2, 0, 0); cam.data.ortho_scale = 1.0 + 1.15 * len(builds)
for vn, ang in {'front': 0, 'q34': 40, 'side': 90, 'back': 180}.items():
    for ob in bpy.data.objects:
        if ob.type == 'MESH': ob.rotation_euler = (0, 0, math.radians(ang))
    scene.render.filepath = f'{prefix}_{vn}.png'
    bpy.ops.render.render(write_still=True)
print('DONE')
