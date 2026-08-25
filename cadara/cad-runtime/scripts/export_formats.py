#!/usr/bin/env python3
"""Convert a STEP file to other formats using the bundled CAD runtime.

Formats: stl, obj, ply, 3mf, iges, dxf, svg.

Notes:
- obj/ply/3mf are written from the tessellated mesh (build123d 0.11 has
  no native writers for these); the files are standard and open in any
  CAD/DCC tool.
- dxf/svg project the solid onto the XY plane (top view) via the
  build123d 2D exporters.
"""
import argparse
import os
import sys
import zipfile


def _mesh(part, tolerance=0.2):
    """Tessellate a shape into ([(x, y, z)], [(i, j, k)] triangle indices)."""
    verts, tris = part.tessellate(tolerance)
    return [(v.X, v.Y, v.Z) for v in verts], tris


def _write_obj(path, verts, tris):
    lines = [f"# Cadara OBJ export — {len(verts)} vertices, {len(tris)} faces"]
    for x, y, z in verts:
        lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
    for i, j, k in tris:
        lines.append(f"f {i + 1} {j + 1} {k + 1}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _write_ply(path, verts, tris):
    header = (
        "ply\n"
        "format ascii 1.0\n"
        "comment Cadara PLY export\n"
        f"element vertex {len(verts)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        f"element face {len(tris)}\n"
        "property list uchar int vertex_indices\n"
        "end_header\n"
    )
    lines = [header]
    for x, y, z in verts:
        lines.append(f"{x:.6f} {y:.6f} {z:.6f}")
    for i, j, k in tris:
        lines.append(f"3 {i} {j} {k}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _write_3mf(path, verts, tris):
    """Write a minimal but valid 3MF (ZIP-based) mesh package."""
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        "</Relationships>"
    )
    items = "".join(
        f'<vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>' for x, y, z in verts
    )
    faces = "".join(
        f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in tris
    )
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        "<resources>"
        f'<object id="1" type="model"><mesh><vertices>{items}</vertices>'
        f"<triangles>{faces}</triangles></mesh></object>"
        "</resources>"
        '<build><item objectid="1"/></build>'
        "</model>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)


def export_format(step_path, fmt, output_path):
    import build123d as bd
    from build123d.exporters import ExportDXF, ExportSVG

    try:
        part = bd.import_step(step_path)

        if fmt == "stl":
            bd.export_stl(part, output_path)

        elif fmt == "obj":
            verts, tris = _mesh(part)
            _write_obj(output_path, verts, tris)

        elif fmt == "ply":
            verts, tris = _mesh(part)
            _write_ply(output_path, verts, tris)

        elif fmt == "3mf":
            verts, tris = _mesh(part)
            _write_3mf(output_path, verts, tris)

        elif fmt in ("iges", "igs"):
            from OCP.IGESControl import IGESControl_Controller, IGESControl_Writer
            IGESControl_Controller.Init_s()
            writer = IGESControl_Writer()
            writer.AddShape(part.wrapped)
            writer.Write(output_path)

        elif fmt == "dxf":
            exporter = ExportDXF(unit=bd.Unit.MM)
            exporter.add_shape(part)
            exporter.write(output_path)

        elif fmt == "svg":
            exporter = ExportSVG(unit=bd.Unit.MM)
            exporter.add_shape(part)
            exporter.write(output_path)

        else:
            print(f"Unsupported format: {fmt}", file=sys.stderr)
            sys.exit(1)

        print(f"Successfully exported {output_path}")

    except Exception as e:
        print(f"Export error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Convert STEP to other formats")
    parser.add_argument("input", help="Path to input STEP file")
    parser.add_argument("--format", required=True, help="Target format (stl, obj, ply, 3mf, iges, dxf, svg)")
    parser.add_argument("--output", required=True, help="Path to output file")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    export_format(args.input, args.format, args.output)


if __name__ == "__main__":
    main()
