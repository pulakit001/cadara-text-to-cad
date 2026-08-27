"""Mid-engine sports car — side-silhouette extrusion with greenhouse,
cut wheel arches, five-spoke wheels, splitter, rear wing with endplates,
headlights, taillight strip, mirrors, exhaust tips. Nose along +X."""

from build123d import *

WHEEL_X = (+150, -150)
WHEEL_Z = 34
TIRE_R, TIRE_W = 33, 26

def gen_step():
    # body silhouette (x = length, y = height), extruded across width
    profile = [
        (230, 14), (150, 30), (95, 38), (60, 42), (15, 78),
        (-55, 76), (-120, 55), (-195, 48), (-215, 42),
        (-215, 16), (200, 12),
    ]
    car = Pos(0, 90, 0) * Rot(X=90) * extrude(Polygon(*profile, align=None), 180)

    # greenhouse canopy, narrower than the body
    canopy_pts = [(62, 40), (18, 80), (-52, 79), (-92, 50)]
    car += Pos(0, 70, 0) * Rot(X=90) * extrude(Polygon(*canopy_pts, align=None), 140)

    # wheel arch pockets (per side, leaving a center web the hubs tie into)
    for wx in WHEEL_X:
        for s in (+1, -1):
            car -= Pos(wx, s * 76, WHEEL_Z) * Rot(X=90) * Cylinder(42, 30)

    # front intake mouth + rear grill cutout
    car -= Pos(225, 0, 22) * Rot(Y=90) * Cylinder(20, 60)
    car -= Pos(-216, 0, 30) * Box(20, 100, 14)

    # splitter, side skirts, diffuser fins
    car += Pos(218, 0, 10) * Box(70, 178, 8)
    for ys in (+91, -91):
        car += Pos(0, ys, 12) * Box(240, 8, 10)
    for i in range(4):
        car += Pos(-190 - i * 7, 0, 10) * Box(24, 6, 16)

    # rear wing: blade, endplates, struts (struts overlap the deck)
    car += Pos(-208, 0, 82) * Box(46, 170, 6)
    for ys in (+82, -82):
        car += Pos(-208, ys, 74) * Box(40, 6, 22)
    for ys in (+45, -45):
        car += Pos(-202, ys, 58) * Box(10, 8, 28)

    # lights (headlights embedded in the hood slope)
    for ys in (+55, -55):
        car += Pos(168, ys, 30) * Box(8, 36, 10)
    car += Pos(-213, 0, 40) * Box(10, 150, 10)

    # mirrors
    for s in (+1, -1):
        car += Pos(48, s * 94, 48) * Box(6, 16, 8)
        car += Pos(46, s * 101, 48) * Box(18, 8, 12)

    # exhaust tips
    for ys in (+35, -35):
        car -= Pos(-219, ys, 22) * Rot(Y=90) * Cylinder(7.5, 20)

    # wheels: tire + rim + hub axle tying into the body web, five spokes
    for wx in WHEEL_X:
        for s in (+1, -1):
            wy = s * 78
            car += Pos(wx, wy, WHEEL_Z) * Rot(X=90) * Cylinder(TIRE_R, TIRE_W)
            car += Pos(wx, wy, WHEEL_Z) * Rot(X=90) * Cylinder(19, TIRE_W + 3)
            car += Pos(wx, s * 76, WHEEL_Z) * Rot(X=90) * Cylinder(7, 34)
            for k in range(5):
                a = k * 72
                car += (
                    Pos(wx, wy, WHEEL_Z) * Rot(Y=a)
                    * Pos(11, 0, 0) * Box(22, TIRE_W - 2, 5)
                )

    return car
