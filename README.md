# vast-ai-provisioner

This script will provision a [Vast.ai](https://vast.ai) instance with a specific template which can be overridden and customized beyond what is available with Vast's template system. The repo currently provides the following templates:

- "Complete" ComfyUI install - Flux, WAN, Hunyuan, SDXL + variants, ControlNets, and LoRAs
- SDXL ComfyUI install - all of the above minus Flux, WAN, and Hunyuan
- Flux Kontext ComfyUI install - Just Flux Kontext
- [FP-Studio](https://github.com/FP-Studio/FramePack-Studio) - A FramePack-based video editor

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
