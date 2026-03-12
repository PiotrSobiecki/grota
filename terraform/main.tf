locals {
  categories = {
    dokumenty = { lifecycle_days = 365 }
    projekty  = { lifecycle_days = 730 }
    media     = { lifecycle_days = 0 } # 0 = no auto-delete
  }
}

module "bucket" {
  source   = "./modules/b2-bucket"
  for_each = local.categories

  bucket_name    = "${var.bucket_prefix}-${each.key}"
  lifecycle_days = each.value.lifecycle_days
}
