-- Redacted-number placeholders ("+385∙∙∙∙∙∙∙06") were stored as names and
-- hid real contact names.
UPDATE chats SET name = '' WHERE name LIKE '%∙%';
UPDATE contacts SET push_name = '' WHERE push_name LIKE '%∙%';
UPDATE contacts SET full_name = '' WHERE full_name LIKE '%∙%';
UPDATE contacts SET business_name = '' WHERE business_name LIKE '%∙%';
