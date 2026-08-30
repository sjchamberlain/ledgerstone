<?php
// Copy this file to config.php and fill in the values from
// cPanel > MySQL Databases (see README.md for the exact steps).
// config.php is excluded from version control on purpose — it holds a password.

return [
  'db_host' => 'localhost',
  'db_name' => 'cpaneluser_pm',      // cPanel prefixes DB names with your account name
  'db_user' => 'cpaneluser_pmuser',  // cPanel prefixes DB users the same way
  'db_pass' => 'CHANGE_ME',
];
