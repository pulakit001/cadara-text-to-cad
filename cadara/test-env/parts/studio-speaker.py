"""Two-way studio monitor speaker — cabinet on a plinth, recessed baffle,
8-inch woofer with surround/cone/dust cap, waveguide tweeter, bass port,
rear heatsink fins and binding posts. Front faces +Y."""

from build123d import *

CAB_W, CAB_D, CAB_H = 220, 260, 360
PLINTH_Z0 = 12                                # cabinet starts above plinth
FRONT_Y = CAB_D / 2                           # 130

def gen_step():
    s = Pos(0, 0, 6) * Box(230, 270, 12)                     # plinth
    for xs in (+95, -95):
        for ys in (+115, -115):
            s -= Pos(xs, ys, -2) * Cylinder(10, 20)          # foot wells
            s += Pos(xs, ys, 3) * Cylinder(10, 7)            # rubber feet
    s += Pos(0, 0, PLINTH_Z0 + CAB_H / 2) * Box(CAB_W, CAB_D, CAB_H)

    cz = PLINTH_Z0                                            # 12
    woofer_z = cz + 122
    tweeter_z = cz + 258
    port_z = cz + 48

    # recessed baffle panel (leaves a border frame around the front)
    s -= Pos(0, FRONT_Y - 4, cz + CAB_H / 2) * Box(190, 10, 330)

    # --- woofer -------------------------------------------------------
    s -= Pos(0, FRONT_Y - 14, woofer_z) * Rot(X=90) * Cylinder(88, 30)   # pocket
    s += Pos(0, FRONT_Y - 1, woofer_z) * Rot(X=90) * Torus(76, 4)        # surround
    s += Pos(0, FRONT_Y - 15, woofer_z) * Rot(X=90) * Cone(80, 22, 34)   # cone
    s += Pos(0, FRONT_Y - 24, woofer_z) * Sphere(20)                     # dust cap
    s += Pos(0, FRONT_Y - 1, woofer_z) * Rot(X=90) * Torus(88, 3)        # trim ring

    # --- tweeter ------------------------------------------------------
    s -= Pos(0, FRONT_Y - 7, tweeter_z) * Rot(X=90) * Cylinder(38, 16)
    s += Pos(0, FRONT_Y - 13, tweeter_z) * Rot(X=90) * Cone(34, 12, 18)  # waveguide
    s += Pos(0, FRONT_Y - 8, tweeter_z) * Sphere(11)

    # --- bass port (rear panel, flare proud of the back) ---------------
    s -= Pos(0, -FRONT_Y + 21, port_z) * Rot(X=90) * Cylinder(26, 44)
    s += Pos(0, -FRONT_Y - 1, port_z) * Rot(X=90) * Torus(27, 4)

    # grille pins in the baffle frame corners
    for xs in (+102, -102):
        for zs in (woofer_z, tweeter_z):
            s += Pos(xs, FRONT_Y + 3.5, zs) * Rot(X=90) * Cylinder(4, 9)

    # --- rear panel ---------------------------------------------------
    for i in range(6):                                       # heatsink fins
        x = -60 + i * 24
        s += Pos(x, -FRONT_Y - 13, cz + 190) * Box(6, 26, 90)
    for xs in (+30, -30):                                    # binding posts
        s += Pos(xs, -FRONT_Y - 5, cz + 110) * Rot(X=90) * Cylinder(6, 12)
        s += Pos(xs, -FRONT_Y - 3, cz + 110) * Rot(X=90) * Cylinder(8, 4)

    return s
