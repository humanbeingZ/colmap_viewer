"""Command-line launcher for the COLMAP viewer."""

import argparse

import uvicorn

from viewer.app import app, configure_service
from viewer.colmap_service import ColmapService
from viewer.geometry.ply import PlyGeometryLoader


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--image_base_path", type=str, required=True)
    parser.add_argument("-c", "--colmap_project_path", type=str, default=None)
    parser.add_argument("-d", "--database_path", type=str, default=None)
    parser.add_argument(
        "-g",
        "--geometry",
        type=str,
        default=None,
        help="PLY point cloud or mesh to use instead of COLMAP points3D",
    )
    parser.add_argument("-p", "--port", type=int, default=8000)
    args = parser.parse_args()
    if args.geometry:
        try:
            args.geometry = PlyGeometryLoader.resolve_path(
                args.geometry, require_absolute=False
            )
        except ValueError as error:
            parser.error(str(error))
    return args


def main() -> None:
    args = parse_args()
    if not args.colmap_project_path and not args.database_path:
        raise ValueError(
            "You must provide either --colmap_project_path or --database_path"
        )
    configure_service(
        ColmapService(
            image_path=args.image_base_path,
            project_path=args.colmap_project_path,
            db_path=args.database_path,
            geometry_path=args.geometry,
        )
    )
    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
