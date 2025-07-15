import 'dotenv/config';
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
      'Min. amount of GPU VRAM in GB',
      (val) => parseInt(val, 10),
      16
    )
    .option(
      '--max-hourly-cost <cost>',
      'Max. instance cost in $/hr',
      (val) => parseInt(val, 10),
      1
    )
    .option(
      '--max-ports <count>',
      'Max. number of ports on machine',
      (val) => parseInt(val, 10),
      1000
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
