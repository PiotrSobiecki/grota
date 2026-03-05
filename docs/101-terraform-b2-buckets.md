# 101: Terraform B2 Buckets

## Goal

Provision Backblaze B2 buckets (per-category) with SSE-B2 encryption, lifecycle rules, and per-bucket application keys using Terraform -- enabling the backup scripts to push data to B2.

## Prerequisites

- Backblaze B2 account created
- `terraform` >= 1.5 installed
- B2 master application key (for Terraform provider auth)

## Scope

### IN

- `terraform/` directory with modular B2 bucket provisioning
- `modules/b2-bucket/` -- reusable module: bucket + lifecycle + app key
- Root config creating 3 buckets per deployment: `{prefix}-dokumenty`, `{prefix}-media`, `{prefix}-projekty`
- SSE-B2 (AES-256) encryption at rest
- Lifecycle rules per PLAN.md retention policy
- Per-bucket application keys (least privilege)
- `terraform.tfvars.example` with documented variables
- Outputs: bucket names, key IDs, app keys

### OUT

- rclone config using B2 keys (doc 102)
- Backup scripts (doc 103+)
- Multi-deployment Terraform workspaces (future)

## Decisions

| Item | Decision |
|------|----------|
| Provider | `backblaze/b2` Terraform provider |
| Encryption | SSE-B2 (server-side, AES-256) -- B2 default encryption, no client-side key management |
| Lifecycle | `dokumenty` 365d, `projekty` 730d, `media` no auto-delete |
| App keys | One key per bucket, read+write, restricted to bucket namespace |
| State | Local state for MVP. Remote backend (S3/B2) for multi-deployment future. |
| Multi-deployment | Separate tfvars per client in `terraform/clients/{name}.tfvars`. |
| Lifecycle strategy | Direct delete after N days. `rclone --backup-dir` is the recovery layer (doc 103), not B2 lifecycle. |

## Files

### `terraform/versions.tf`

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.9"
    }
  }
}

provider "b2" {
  application_key_id = var.b2_master_key_id
  application_key    = var.b2_master_key
}
```

### `terraform/variables.tf`

```hcl
variable "b2_master_key_id" {
  description = "B2 master application key ID"
  type        = string
  sensitive   = true
}

variable "b2_master_key" {
  description = "B2 master application key"
  type        = string
  sensitive   = true
}

variable "bucket_prefix" {
  description = "Prefix for bucket names, e.g. client slug"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.bucket_prefix))
    error_message = "bucket_prefix must be lowercase alphanumeric with hyphens"
  }
}
```

### `terraform/main.tf`

```hcl
locals {
  categories = {
    dokumenty = { lifecycle_days = 365 }
    projekty  = { lifecycle_days = 730 }
    media     = { lifecycle_days = 0 }  # 0 = no auto-delete
  }
}

module "bucket" {
  source   = "./modules/b2-bucket"
  for_each = local.categories

  bucket_name    = "${var.bucket_prefix}-${each.key}"
  lifecycle_days = each.value.lifecycle_days
}
```

### `terraform/outputs.tf`

```hcl
output "buckets" {
  description = "Created bucket details"
  value = {
    for k, v in module.bucket : k => {
      bucket_name = v.bucket_name
      bucket_id   = v.bucket_id
      key_id      = v.key_id
      app_key     = v.app_key
    }
  }
  sensitive = true
}

output "bucket_names" {
  description = "Bucket names (non-sensitive)"
  value = {
    for k, v in module.bucket : k => v.bucket_name
  }
}
```

### `terraform/terraform.tfvars.example`

```hcl
# Copy to terraform.tfvars and fill in values
# DO NOT commit terraform.tfvars to git

b2_master_key_id = ""
b2_master_key    = ""
bucket_prefix    = "firmaxyz"  # lowercase, e.g. client slug
```

### `terraform/clients/example.tfvars`

```hcl
# Per-client tfvars -- one file per deployment
# Usage: terraform apply -var-file=clients/firmaxyz.tfvars
bucket_prefix = "firmaxyz"
```

### `terraform/modules/b2-bucket/main.tf`

```hcl
variable "bucket_name" {
  type = string
}

variable "lifecycle_days" {
  type    = number
  default = 0
}

resource "b2_bucket" "this" {
  bucket_name = var.bucket_name
  bucket_type = "allPrivate"

  default_server_side_encryption {
    algorithm = "AES256"
    mode      = "SSE-B2"
  }

  dynamic "lifecycle_rules" {
    for_each = var.lifecycle_days > 0 ? [1] : []
    content {
      file_name_prefix             = ""
      days_from_hiding_to_deleting = var.lifecycle_days
      days_from_uploading_to_hiding = 0
    }
  }
}

resource "b2_application_key" "this" {
  key_name     = "${var.bucket_name}-key"
  bucket_id    = b2_bucket.this.bucket_id
  capabilities = ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"]
}
```

### `terraform/modules/b2-bucket/outputs.tf`

```hcl
output "bucket_name" {
  value = b2_bucket.this.bucket_name
}

output "bucket_id" {
  value = b2_bucket.this.bucket_id
}

output "key_id" {
  value     = b2_application_key.this.application_key_id
  sensitive = true
}

output "app_key" {
  value     = b2_application_key.this.application_key
  sensitive = true
}
```

### `terraform/.gitignore`

```
*.tfstate
*.tfstate.backup
.terraform/
.terraform.lock.hcl
terraform.tfvars
```

## Implementation Steps

1. **Create directory structure**
   ```bash
   mkdir -p terraform/modules/b2-bucket
   ```

2. **Create all Terraform files** as specified above

3. **Create `.gitignore`** in `terraform/`

4. **Verify syntax**
   ```bash
   cd terraform && terraform fmt -check -recursive
   ```

5. **Initialize**
   ```bash
   cd terraform && terraform init
   ```

## Manual Test Script

```bash
# 1. Setup
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Fill in B2 master key credentials + bucket_prefix

# 2. Init
terraform init
# Expect: provider downloaded, initialized

# 3. Validate
terraform validate
# Expect: "Success! The configuration is valid."

# 4. Format check
terraform fmt -check -recursive
# Expect: no formatting issues

# 5. Plan (dry-run)
terraform plan
# Expect: 6 resources to create (3 buckets + 3 app keys)
# Verify:
#   - Bucket names: {prefix}-dokumenty, {prefix}-projekty, {prefix}-media
#   - SSE-B2 encryption on all buckets
#   - Lifecycle: 365d on dokumenty, 730d on projekty, none on media
#   - App key per bucket with correct capabilities

# 6. Apply (optional -- creates real B2 resources)
terraform apply
# Expect: 6 resources created

# 7. Verify outputs
terraform output -json buckets
# Expect: JSON with bucket_name, bucket_id, key_id, app_key per category

# 8. Verify in B2 console
# Login to Backblaze B2 web UI
# Confirm 3 buckets exist with correct names
# Confirm encryption enabled
# Confirm lifecycle rules match

# 9. Cleanup (if testing only)
terraform destroy
```

## Unresolved Questions

- Should Terraform outputs be piped into grota.env automatically?
