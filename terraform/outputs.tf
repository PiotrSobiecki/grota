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
