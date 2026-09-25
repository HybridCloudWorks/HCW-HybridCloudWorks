# hcw-lab

A browser workspace for the HybridCloudWorks labs: VS Code (code-server) on
the `hcw-lab` image, which carries `az`, `terraform`, `kubectl`, `helm`,
`ansible` and `git`. Pick a lab and the folder for it is checked out and
opened for you.

- **One CPU, 2 GiB of memory, one hour.** The workspace stops itself an hour
  after it starts; your files in the home folder survive a stop and come
  back when you start it again. Deleting the workspace deletes them.
- **You are `nobody` (uid 65534)**, with no `sudo`, no Docker, no access to
  the host. Everything a lab needs is already installed.
- **Network is on**, so `az login --use-device-code` and `terraform init`
  work.

Source: `lab-host/coder/templates/hcw-lab` in
[HybridCloudWorks/HCW-HybridCloudWorks](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks).
