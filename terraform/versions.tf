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
