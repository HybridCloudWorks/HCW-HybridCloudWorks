# You are working in a landing zone generated for learning

This folder is the output of the Landing Zone Builder at
<https://hybridcloudworks.com/tools/landing-zone>, a teaching tool by
HybridCloudWorks. It is Terraform that composes Azure Verified Modules
(management groups, policy, management, connectivity hub, identity and
application spokes) the way the modules' own examples do. It was generated
so that a learner can read, validate and ask about it. It has never been
applied anywhere, and it must not be applied from here.

## What to do

1. Run `terraform init -backend=false` first. It downloads the providers and
   modules the files declare and configures no state backend; nothing about
   it touches an Azure tenant.
2. Run `terraform fmt -check` and `terraform validate`, and report exactly
   what each printed. If `fmt -check` lists a file, show the diff
   (`terraform fmt -diff`) rather than rewriting it silently.
3. Explain the files: what `terraform.tf`, `providers.tf`, `variables.tf` and
   each component file (`alz.tf`, `management.tf`, `connectivity.tf`,
   `identity.tf`, `application.tf`, `subscriptions.tf` when present) would
   create, which Azure Verified Module each one calls and at what version,
   and how the pieces reference each other. Read the README the builder
   wrote; it names what was selected.
4. Answer the learner's questions from the files in front of you. When a
   question needs a fact the files do not hold, say so rather than guess.

## What never to do

- Never run `terraform apply`, `terraform plan`, `terraform destroy` or
  `terraform import`, with or without `-backend=false`, and never suggest the
  learner runs them here. A plan needs credentials to a real tenant; this
  sandbox has none and this folder is not meant for one.
- Never run `az login` or any `az` command that reads or changes a
  subscription. `az` is installed so you can answer questions about its
  syntax and show what a command *would* do (`az --help`, `az ... --help`),
  not so you can reach a tenant.
- Never write real subscription ids, tenant ids, secrets or credentials into
  these files, and never ask the learner for any.
- Never change the module versions or provider constraints to "make it
  work"; report what fails and why.

## Tools

`terraform` and `az` are installed at the versions pinned in
`lab-image/versions.env` of the HybridCloudWorks repository. `terraform
version` and `az version` print them.
