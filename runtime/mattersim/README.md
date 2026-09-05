# MatterSim runtime asset

NebulaMat uses the exact **MatterSim-v1.0.0-5M** checkpoint for the first
structure/relaxation screen. The checkpoint is downloaded from the official
Microsoft MatterSim v1.0.0 release and is loaded by
`runtime/materials-mcp/materials_mcp/mattersim_adapter.py`.

Expected local path:

```text
runtime/mattersim/models/mattersim-v1.0.0-5M.pth
```

The bundled checkpoint is 91,176,875 bytes (SHA-256:
`e3df9fa708725e3d453140646c7d1838324b347a3d1214cf1440522146f872b5`).

Official source:

<https://github.com/microsoft/mattersim/tree/v1.0.0/pretrained_models>

The adapter records the checkpoint SHA-256 in every result. MatterSim-v1 is
primarily bulk-trained; slab/interface outputs remain pre-screen evidence and
must be calibrated against the VASP protocol before scientific claims or
experimental selection.
