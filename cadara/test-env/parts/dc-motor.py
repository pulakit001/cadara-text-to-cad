"""Industrial DC motor — finned body, end bells, front flange with bolt
holes, keyed-look shaft, perforated fan cowl, terminal box with cable
glands, lifting lug, mounting feet. Shaft axis along X, ground at Z=0."""

from build123d import *

BODY_R = 50

def gen_step():
    # stator body (axis along X via Rot(Y=90) applied before placement)
    m = Pos(0, 0, 64) * Rot(Y=90) * Cylinder(BODY_R, 200)

    # cooling fins
    for i in range(14):
        x = -84 + i * 13
        m += Pos(x, 0, 64) * Rot(Y=90) * Cylinder(54, 4)

    # feet + bolt holes
    for xs in (+70, -70):
        m += Pos(xs, 0, 7) * Box(90, 110, 14)
        for ys in (+38, -38):
            m -= Pos(xs, ys, 10) * Cylinder(5, 20)

    # end bells
    m += Pos(109, 0, 64) * Rot(Y=90) * Cylinder(51, 18)
    m += Pos(-109, 0, 64) * Rot(Y=90) * Cylinder(51, 18)

    # front mounting flange with four bolt holes
    m += Pos(123, 0, 64) * Rot(Y=90) * Cylinder(62, 10)
    for k in range(4):
        a = k * 90
        m -= Pos(123, 0, 64) * Rot(X=a) * Pos(50, 0, 0) * Rot(Y=90) * Cylinder(4.5, 14)

    # shaft with keyway notch on top near the free end
    m += Pos(148, 0, 64) * Rot(Y=90) * Cylinder(8, 40)
    m -= Pos(160, 0, 69) * Box(14, 4.2, 5)

    # rear fan cowl with intake perforations
    m += Pos(-138, 0, 64) * Rot(Y=90) * Cylinder(44, 40)
    for k in range(8):
        a = k * 45
        m -= Pos(-151, 0, 64) * Rot(X=a) * Pos(30, 0, 0) * Rot(Y=90) * Cylinder(3, 16)

    # terminal box, glands, lid screw bumps
    m += Pos(0, 0, 131) * Box(56, 44, 34)
    m += Pos(-14, 0, 155) * Cylinder(8, 14)
    m += Pos(16, 0, 153) * Cylinder(6, 10)
    for xs in (-22, 22):
        for ys in (-16, 16):
            m += Pos(xs, ys, 149) * Cylinder(2.5, 4)

    # nameplate on the side of the body
    m += Pos(-40, 48, 78) * Box(64, 6, 28)

    # lifting eyebolt between fins and terminal box
    m += Pos(-60, 0, 126) * Torus(14, 4)

    return m
