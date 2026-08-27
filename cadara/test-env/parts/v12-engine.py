"""V12 engine — two 32-degree banks, six cylinders per bank, ITB stacks,
pulley drive, flywheel, sump. Crank axis along X, ground at Z=0."""

from build123d import *

CYL_X = [-155, -93, -31, 31, 93, 155]      # cylinder bore centers
BANK_TILT = 32                              # included V angle = 64 deg
BLOCK_TOP_Z = 140                           # crankcase deck height

def bank_transform(side):
    """side=+1 leans toward +Y, side=-1 toward -Y."""
    return Pos(0, 0, BLOCK_TOP_Z) * Rot(X=-side * BANK_TILT)

def gen_step():
    eng = Pos(0, 0, 95) * Box(410, 150, 90)                    # crankcase
    eng += Pos(0, 0, 28) * Box(350, 120, 44)                   # oil pan
    eng += Pos(0, 0, 13) * Box(170, 105, 26)                   # sump
    eng += Pos(0, 0, 150) * Box(300, 46, 24)                   # valley plate

    for side in (+1, -1):
        T = bank_transform(side)
        # bank block
        eng += T * Pos(0, 0, 56) * Box(392, 78, 112)

        for x in CYL_X:
            # cylinder jug + head cap
            eng += T * Pos(x, 0, 117) * Cylinder(26, 55)
            eng += T * Pos(x, 0, 114) * Cylinder(29, 12)
            # exhaust stub exiting the outer side of the head
            eng += T * Pos(x, side * 48, 98) * Rot(Y=90) * Cylinder(8, 24)

        # cam valve cover over the jugs
        eng += T * Pos(0, 0, 132) * Box(334, 60, 34)
        # cover rib
        eng += T * Pos(0, 0, 149) * Box(340, 22, 6)

    # intake plenum in the valley + 12 velocity stacks
    eng += Pos(0, 0, 195) * Box(310, 44, 34)
    for side in (+1, -1):
        for x in CYL_X:
            eng += Pos(x, side * 11, 225) * Cylinder(9, 26)
            eng += Pos(x, side * 11, 241) * Cylinder(14, 7)

    # front accessory drive (crank + alternator pulleys, nose)
    eng += Pos(228, 0, 95) * Rot(Y=90) * Cylinder(42, 18)
    eng += Pos(243, 0, 95) * Rot(Y=90) * Cylinder(28, 14)
    eng += Pos(256, 0, 95) * Rot(Y=90) * Cylinder(10, 16)

    # rear flywheel
    eng += Pos(-218, 0, 95) * Rot(Y=90) * Cylinder(72, 16)
    eng += Pos(-226, 0, 95) * Rot(Y=90) * Cylinder(74, 4)

    # engine mounts
    for xs in (+120, -120):
        for ys in (+83, -83):
            eng += Pos(xs, ys, 60) * Box(40, 24, 30)

    return eng
