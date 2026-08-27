"""Luxury wristwatch, 42 mm case laid dial-up — stepped bezel, open dial
with twelve applied markers and 10:09:31 hands, knurled crown, four lugs,
flat three-link bracelet with taper and a buckle. Ground at Z=0."""

from build123d import *

def gen_step():
    w = Pos(0, 0, 1.5) * Cylinder(21, 3)                    # caseback
    w += Pos(0, 0, 7) * Cylinder(22, 8)                     # case middle
    w += Pos(0, 0, 13) * Cylinder(19.5, 4)                  # bezel base
    w -= Pos(0, 0, 13) * Cylinder(18.2, 6)                  # bezel opening
    w += Pos(0, 0, 15) * Torus(20.5, 1.6)                   # bezel top edge

    # dial sitting inside the opening
    w += Pos(0, 0, 11.9) * Cylinder(17.8, 1.4)

    # applied hour markers (double baton at 12)
    for h in range(12):
        a = h * 30
        if h == 0:
            for dx in (-1.9, 1.9):
                w += Rot(Z=a) * Pos(dx, 14.2, 12.9) * Box(1.7, 5.5, 1.2)
        else:
            w += Rot(Z=a) * Pos(0, 14.2, 12.9) * Box(2.4, 6, 1.2)

    # hands set to 10:09:31 plus center cap
    w += Pos(0, 0, 13.3) * Rot(Z=-55) * Pos(0, 4.5, 0) * Box(2.4, 11, 1.1)
    w += Pos(0, 0, 13.65) * Rot(Z=54) * Pos(0, 6.5, 0) * Box(2.0, 16.5, 1.0)
    w += Pos(0, 0, 13.95) * Rot(Z=145) * Box(0.9, 23, 0.7)
    w += Pos(0, 0, 13.6) * Cylinder(2, 2.6)

    # knurled crown at 3 o'clock (ridges swept radially in the YZ plane)
    w += Pos(24, 0, 7) * Rot(Y=90) * Cylinder(3.5, 5)
    for k in range(12):
        a = k * 30
        w += Pos(24, 0, 7) * Rot(X=a) * Pos(0, 0, 3.4) * Cylinder(0.8, 4.6)

    # caseback engraving rings
    w += Pos(0, 0, -0.2) * Torus(16, 0.7)
    w += Pos(0, 0, -0.2) * Torus(10, 0.7)

    # lugs
    for xs in (+11.5, -11.5):
        for s in (+1, -1):
            w += Pos(xs, s * 23, 6) * Box(6, 10, 8)

    # flat three-link bracelet, tapering away from the case
    for side in (+1, -1):
        for i in range(5):
            y = side * (29 + i * 14.2)
            t = 1 - i * 0.07
            w += Pos(0, y, 1.7) * Box(9 * t, 13.0, 3.4)
            for xs in (+7.4, -7.4):
                w += Pos(xs * t, y, 1.6) * Box(5 * t, 13.0, 3.0)

    # buckle frame + tang on the -Y branch end
    w += Pos(0, -96.5, 2) * Box(18, 10, 4)
    w -= Pos(0, -97, 2) * Box(14, 8, 8)
    w += Pos(0, -100, 3) * Box(2.2, 16, 1.6)

    return w
