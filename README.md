# vast-ai-provisioner

This script will provision a [Vast.ai](https://vast.ai) instance with a specific template which can be overridden and customized beyond what is available with Vast's template system. The repo currently provides the following templates:

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - A node-based AI image/video generation suite
- [FP-Studio](https://github.com/FP-Studio/FramePack-Studio) - A FramePack-based video editor

Additionally, there are several modules available to add to the base ComfyUI install:

- Animagine: Animagine XL 4.0, a best-in-class anime model
- Flux Dev: Adds Flux 1.Dev and ControlNet
- Flux Kontext: Adds Flux Kontext for image editing
- Pixel Art: Adds Pixel Art LoRAs for SDXL
- SDXL: Adds SDXL and ControlNet
- Upscalers: A collection of high quality 2x and 4x upscalers
- Utility Nodes: A set of Comfy nodes to make building workflows easier
- WAN2.2: A powerful text-to-video or image-to-video model

## Requirements

- Node >=22

## Usage

```sh
npm install -g vast-ai-provisioner
vast-ai-provisioner -h

OR

npx vast-ai-provisioner -h
```

## Development

```sh
corepack enable
yarn install
yarn run build
node lib/index.js <template>
```

Template is an optional argument - if you do not provide it, the application will ask you which one you want to deploy.
