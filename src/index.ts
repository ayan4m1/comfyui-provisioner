import { program } from '@commander-js/extra-typings';

// eslint-disable-next-line import-x/no-unresolved
import { getPackageInfo, provision } from './utils.js';

try {
  const { name, version, description } = await getPackageInfo();

  await program
    .name(name)
    .version(version)
    .description(description)
    .argument('[template]', 'Specify template to deploy')
    .option(
      '--min-vram <gb>',
      'Minimum amount of VRAM in GB',
      (val) => parseInt(val, 10),
      16
    )
    .action((template, opts) =>
      provision({
        template,
        ...opts
      })
    )
    .parseAsync();
} catch (error) {
  console.error(error);
  process.exit(1);
}
