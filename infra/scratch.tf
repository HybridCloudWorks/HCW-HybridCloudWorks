# =============================================================================
# scratch.tf — REMOVED 2026-08-24
#
# This file declared the legacy rehearsal estate: a second Cosmos account, a
# second storage account, their resource group, and four role assignments on
# the GitHub deploy identity, all gated behind cosmos_scratch_enabled and
# storage_scratch_enabled. The owner confirmed the migration rehearsal is
# finished, so the declarations and both variables are gone.
#
# The file is kept as the record. Everything here was created for a reason and
# destroyed for a reason, and "where did the sandbox go" should be answerable
# from the directory it lived in rather than from git archaeology.
#
# WHAT AN APPLY DESTROYS, if these resources are in state:
#
#   azurerm_resource_group.scratch          rg-db-site-sbx-cus
#   azurerm_cosmosdb_account.scratch        cosmos-site-sbx-cus
#   azurerm_cosmosdb_sql_database.scratch   hcw
#   azurerm_cosmosdb_sql_container.scratch  73 containers, the whole generated
#                                           spec in cosmos-containers.json
#   azurerm_storage_account.scratch         stsitesbxcus01
#   azurerm_storage_container.scratch       6 containers
#   azurerm_cosmosdb_sql_role_assignment.scratch_github_deploy
#   azurerm_role_assignment.scratch_reader
#   azurerm_role_assignment.scratch_blob
#   azurerm_role_assignment.scratch_storage_network
#
# THIS DESTROYS A FULL COPY OF PRODUCTION DATA AND IT IS IRREVERSIBLE. The live
# account was measured on 2026-08-24 at 73 containers and 77,763 documents,
# against 69,979 in production — the sandbox held MORE than the system it was
# copied from. Nothing here ever carried prevent_destroy, and that was
# deliberate; the header this file used to have said so outright: "NO
# prevent_destroy — it is meant to be destroyed." Continuous 7-day backup
# was configured on the account, and it goes with the account: a deleted Cosmos
# account cannot be restored from its own continuous backup once the account is
# gone. There is no undo after the apply, only a fresh copy from production.
#
# The three GitHub repository variables that pointed at this estate —
# COSMOS_SCRATCH_ENDPOINT, STORAGE_SCRATCH_ACCOUNT and SCRATCH_RESOURCE_GROUP —
# are orphaned by the same change. Their Terraform outputs are removed in
# outputs.tf; clearing the repository variables themselves is a settings change
# and is not Terraform's to make.
#
# WHAT WAS WORTH KEEPING FROM THE ORIGINAL DESIGN, if a sandbox is ever needed
# again. It mirrored production deliberately — serverless, same region, Session
# consistency, the same database name, the same container spec with the same
# partition keys, TTLs and indexes — and it kept ACCOUNT KEYS OFF, because a
# key-authenticated rehearsal passes while proving nothing about
# DefaultAzureCredential and native RBAC, which is the path production takes.
# The healer's 2026-08-20 "cannot be authorized by AAD token in data plane"
# failure is the class of defect a key would have hidden. It also had its own
# resource group so nothing carrying prevent_destroy shared it, and `sbx` in the
# environment slot so a name could never be mistaken for production in a log
# line.
#
# What it did NOT have, and what a replacement needs on day one, is a stated
# lifetime. This estate held a copy of production for longer than anyone
# intended because the thing that decided when to destroy it — a workspace
# variable — lived somewhere other than the thing being created. Write the
# expiry next to the resource.
# =============================================================================
