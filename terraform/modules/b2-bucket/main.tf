terraform {
  required_providers {
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.9"
    }
  }
}

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
      file_name_prefix              = ""
      days_from_hiding_to_deleting  = var.lifecycle_days
      days_from_uploading_to_hiding = 0
    }
  }
}

resource "b2_application_key" "this" {
  key_name     = "${var.bucket_name}-key"
  bucket_id    = b2_bucket.this.bucket_id
  capabilities = ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"]
}
