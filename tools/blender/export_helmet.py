# blender -b --factory-startup -P tools/blender/export_helmet.py -- "<American Football Helmet.blend>" src/assets/helmet.json
# Turns the CC0 BlendSwap helmet (Noseferrit, blend #76058; see src/assets/CREDITS.md) into src/assets/helmet.json: shell, facemask,
# chin strap + padding + fixings (vertex-colored), plus a side logo patch projected onto the real shell (no crown stripe: not wanted).
# Axes: Blender (x, y, z) with the face toward -y and up +z  →  game (x, z, -y): face toward +z, up +y; scaled to a 0.30 yd wide shell.
import bpy, bmesh, json, base64, struct, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
BUDGET = {'shell': 2600, 'mask': 3000, 'chin': 2400}   # triangles per part (22 players on screen: keep it light)
bpy.ops.wm.open_mainfile(filepath=src)
dg = bpy.context.evaluated_depsgraph_get()

def evaluated(name, subsurf_level=None):
    ob = bpy.data.objects[name]
    for m in ob.modifiers:
        if m.type == 'SUBSURF' and subsurf_level is not None: m.levels = subsurf_level
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=bpy.context.evaluated_depsgraph_get())
    me.transform(ob.matrix_world)
    return me

def decimated(me, target_tris):
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    tris = len(me.polygons)
    if tris <= target_tris: return me
    ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('d', 'DECIMATE'); mod.ratio = target_tris / tris
    bpy.context.view_layer.update()
    res = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    return res

parts = {
    'shell': ('Helmet', 1, [('Helmet', (1, 1, 1))]),
    'mask': ('Helmet Grill', None, [('Helmet Grill', (1, 1, 1))]),
}
meshes = {}
meshes['shell'] = decimated(evaluated('Helmet', 1), BUDGET['shell'])
meshes['mask'] = decimated(evaluated('Helmet Grill', None), BUDGET['mask'])
chin_parts = [('Helmet Strap', 1, (0.93, 0.93, 0.93)), ('Helmet Padding', 1, (0.1, 0.1, 0.1)), ('Helmet Fixings', 1, (0.55, 0.57, 0.6))]

# Geometry centre / scale from the shell: 0.30 yd wide, origin at the middle of the dome.
sb = meshes['shell']
xs = [v.co.x for v in sb.vertices]; ys = [v.co.y for v in sb.vertices]; zs = [v.co.z for v in sb.vertices]
width = max(xs) - min(xs)
S = 0.30 / width
C = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs) + (max(zs) - min(zs)) * 0.46))
print('shell bounds x', min(xs), max(xs), 'y', min(ys), max(ys), 'z', min(zs), max(zs), 'scale', S)

def conv(v): return ((v.x - C.x) * S, (v.z - C.z) * S, -(v.y - C.y) * S)
def convn(n): return (n.x, n.z, -n.y)

def pack(vertices, normals, colors, tris):
    # weld identical (position, normal, color) so the exported mesh is indexed
    key = {}; P = []; N = []; K = []; I = []
    for t in tris:
        for vi in t:
            k = (tuple(round(c, 5) for c in vertices[vi]), tuple(round(c, 2) for c in normals[vi]), colors[vi])
            if k not in key: key[k] = len(P); P.append(vertices[vi]); N.append(normals[vi]); K.append(colors[vi])
            I.append(key[k])
    return P, N, K, I

def mesh_arrays(me, color=(1, 1, 1)):
    me.calc_normals_split()
    V, Nn, K, T = [], [], [], []
    for poly in me.polygons:
        t = []
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            V.append(conv(v.co)); Nn.append(convn(me.loops[li].normal)); K.append(color); t.append(len(V) - 1)
        T.append(t)
    return V, Nn, K, T

def f32(a): return base64.b64encode(struct.pack('<%df' % len(a), *a)).decode()
def u16(a): return base64.b64encode(struct.pack('<%dH' % len(a), *a)).decode()

def part_json(me_list):
    V, Nn, K, T = [], [], [], []
    for me, col in me_list:
        v, n, k, t = mesh_arrays(me, col); off = len(V)
        V += v; Nn += n; K += k; T += [[i + off for i in tri] for tri in t]
    P, N, Kc, I = pack(V, Nn, [tuple(c) for c in K], T)
    return {'count': len(P), 'tris': len(I) // 3, 'position': f32([c for p in P for c in p]), 'normal': f32([c for n in N for c in n]),
            'color': f32([c for k in Kc for c in k]), 'index': u16(I)}

chin_meshes = []
for name, lvl, col in chin_parts:
    me = evaluated(name, lvl); chin_meshes.append((me, col))
chin_tri = sum(len(m.polygons) for m, _ in chin_meshes)
# decimate each chin part in proportion to the budget
chin_dec = []
for me, col in chin_meshes:
    chin_dec.append((decimated(me, max(200, int(BUDGET['chin'] * len(me.polygons) / max(1, chin_tri)))), col))

data = {'source': 'American Football Helmet by Noseferrit, BlendSwap #76058, CC0', 'scale': S,
        'shell': part_json([(meshes['shell'], (1, 1, 1))]), 'mask': part_json([(meshes['mask'], (1, 1, 1))]), 'chin': part_json(chin_dec)}

# ---- side logo patch, projected onto the (undecimated) shell surface ----
shell_hi = evaluated('Helmet', 1)
ob = bpy.data.objects.new('shell_hi', shell_hi); bpy.context.scene.collection.objects.link(ob); bpy.context.view_layer.update()
miny, maxy = min(ys), max(ys)
def ray(origin, direction):
    ok, loc, nor, idx = ob.ray_cast(origin, direction)
    return (loc, nor) if ok else (None, None)
OFF = 0.02
# logo patch on the +x side, above and behind the ear opening: a 12 x 12 grid, u toward the front, v up
G = 12
f0, f1, h0, h1 = 0.16, 0.62, 0.42, 0.92
dp, dn, du, di = [], [], [], []
for j in range(G + 1):
    for i in range(G + 1):
        fu = f0 + (f1 - f0) * i / G; fv = h0 + (h1 - h0) * j / G
        y = maxy - (maxy - miny) * (1 - fu) if False else maxy - (maxy - miny) * fu   # fu = 0 at the back → 1 at the front
        y = miny + (maxy - miny) * (1 - fu)                                         # front is -y
        z = min(zs) + (max(zs) - min(zs)) * fv
        loc, nor = ray(Vector((max(xs) + 5, y, z)), Vector((-1, 0, 0)))
        if loc is None: loc, nor = Vector((max(xs) * 0.9, y, z)), Vector((1, 0, 0))
        p = loc + nor * OFF
        dp.append(conv(p)); dn.append(convn(nor)); du.append((i / G, j / G))
for j in range(G):
    for i in range(G):
        a = j * (G + 1) + i; di += [a, a + G + 1, a + 1, a + 1, a + G + 1, a + G + 2]
data['decal'] = {'count': len(dp), 'position': f32([c for p in dp for c in p]), 'normal': f32([c for n in dn for c in n]),
                 'uv': f32([c for uv in du for c in uv]), 'index': u16(di)}

import os
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
json.dump(data, open(out, 'w'))
print('WROTE', out, round(os.path.getsize(out) / 1024), 'KB;', {k: data[k].get('tris') for k in ('shell', 'mask', 'chin')})
