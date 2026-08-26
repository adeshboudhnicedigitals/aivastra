<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class PluginBootstrapTest extends TestCase
{
    public function test_plugin_file_declares_the_expected_header(): void
    {
        $contents = file_get_contents(__DIR__ . '/../../aivastra-tryon.php');
        $this->assertStringContainsString('Plugin Name: Aivastra Try-On', $contents);
        $this->assertStringContainsString("define('AIVASTRA_TRYON_VERSION'", $contents);
    }
}
