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
