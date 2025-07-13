import { program } from 'commander';

import { getPackageInfo, provision } from './utils.js';

try {
  const { name, version, description } = await getPackageInfo();
  const handler = () =>
    provision({
      script: program.args.pop()
    });

  await program
    .name(name)
    .version(version)
    .description(description)
    .argument('<script>', 'The provisioning script to use')
    .action(handler)
    .parseAsync();
} catch (error) {
  console.error(error);
  process.exit(1);
}
