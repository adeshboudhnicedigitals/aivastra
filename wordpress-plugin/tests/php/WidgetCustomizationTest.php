<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class WidgetCustomizationTest extends TestCase
{
    public function test_defaults_show_add_to_cart_and_share_with_no_copy_overrides(): void
    {
        $this->assertSame([
            'accentColor' => null,
            'buttonColor' => null,
            'buttonGradient' => null,
            'heading' => null,
            'subheading' => null,
            'ctaLabel' => null,
            'addToCart' => true,
            'addToCartLabel' => null,
            'share' => true,
            'shareLabel' => null,
            'buttonPlacement' => null,
        ], Aivastra_Widget_Customization::defaults());
    }

    public function test_sanitize_accepts_a_valid_hex_color_lowercased(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['accentColor' => '#ABCDEF']);
        $this->assertSame('#abcdef', $clean['accentColor']);
    }

    public function test_sanitize_rejects_a_malformed_color(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['accentColor' => 'indigo']);
        $this->assertNull($clean['accentColor']);
    }

    public function test_sanitize_accepts_a_valid_button_color_lowercased(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonColor' => '#ABCDEF']);
        $this->assertSame('#abcdef', $clean['buttonColor']);
    }

    public function test_sanitize_rejects_a_malformed_button_color(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonColor' => 'not-a-color']);
        $this->assertNull($clean['buttonColor']);
    }

    public function test_sanitize_treats_a_missing_button_color_as_null(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([]);
        $this->assertNull($clean['buttonColor']);
    }

    public function test_sanitize_accepts_a_known_button_gradient(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonGradient' => 'ocean']);
        $this->assertSame('ocean', $clean['buttonGradient']);
    }

    public function test_sanitize_rejects_an_unknown_button_gradient(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonGradient' => 'linear-gradient(90deg,red,blue)']);
        $this->assertNull($clean['buttonGradient']);
    }

    public function test_sanitize_treats_a_missing_button_gradient_as_null(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([]);
        $this->assertNull($clean['buttonGradient']);
    }

    public function test_every_button_gradient_value_is_a_css_gradient_function(): void
    {
        foreach (Aivastra_Widget_Customization::BUTTON_GRADIENTS as $slug => $css) {
            $this->assertStringStartsWith('linear-gradient(', $css, "gradient '$slug' should be a linear-gradient()");
        }
    }

    public function test_sanitize_trims_and_strips_tags_from_text_fields(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([
            'heading' => '  <b>Try It On</b>  ',
        ]);
        $this->assertSame('Try It On', $clean['heading']);
    }

    public function test_sanitize_truncates_text_fields_to_their_max_length(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([
            'ctaLabel' => str_repeat('a', 60),
        ]);
        $this->assertSame(str_repeat('a', 40), $clean['ctaLabel']);
    }

    public function test_sanitize_treats_a_blank_field_as_null(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['heading' => '   ']);
        $this->assertNull($clean['heading']);
    }

    public function test_sanitize_reads_checkboxes_as_false_when_absent(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([]);
        $this->assertFalse($clean['addToCart']);
        $this->assertFalse($clean['share']);
    }

    public function test_sanitize_reads_checkboxes_as_true_when_present(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['addToCart' => '1', 'share' => '1']);
        $this->assertTrue($clean['addToCart']);
        $this->assertTrue($clean['share']);
    }

    public function test_sanitize_accepts_a_valid_button_placement(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonPlacement' => 'after_cart']);
        $this->assertSame('after_cart', $clean['buttonPlacement']);
    }

    public function test_sanitize_rejects_an_unknown_button_placement(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize(['buttonPlacement' => 'sidebar']);
        $this->assertNull($clean['buttonPlacement']);
    }

    public function test_sanitize_treats_a_missing_button_placement_as_null(): void
    {
        $clean = Aivastra_Widget_Customization::sanitize([]);
        $this->assertNull($clean['buttonPlacement']);
    }
}
