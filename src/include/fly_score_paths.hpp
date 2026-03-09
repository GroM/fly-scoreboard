#pragma once

#include <QString>

class QWidget;

QString fly_default_data_root();
QString fly_get_data_root_no_ui();
QString fly_get_data_root(QWidget *parentForDialogs = nullptr);
void fly_set_data_root(const QString &path);
