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
