#!/usr/bin/env python3
import argparse
import sys
import os

def export_format(step_path, fmt, output_path):
    import build123d as bd
    
    try:
        # Load the STEP file
        part = bd.import_step(step_path)
        
        # Handle conversion based on format
        if fmt == "obj":
            part.export_stl(output_path.replace(".obj", ".stl"))
                
        elif fmt == "ply":
            part.export_stl(output_path.replace(".ply", ".stl"))
            
        elif fmt in ("iges", "igs"):
            from OCP.IGESControl import IGESControl_Controller, IGESControl_Writer
            IGESControl_Controller.Init_s()
            writer = IGESControl_Writer()
            writer.AddShape(part.wrapped)
            writer.Write(output_path)
            
        elif fmt == "dxf":
            bd.export_dxf(part, output_path)
            
        elif fmt == "svg":
            bd.export_svg(part, output_path)
            
        elif fmt == "3mf":
            if hasattr(part, "export_3mf"):
                part.export_3mf(output_path)
            else:
                part.export_stl(output_path.replace(".3mf", ".stl"))
            
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
    parser.add_argument("--format", required=True, help="Target format (obj, ply, iges, dxf, svg, 3mf)")
    parser.add_argument("--output", required=True, help="Path to output file")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)
        
    export_format(args.input, args.format, args.output)

if __name__ == "__main__":
    main()
